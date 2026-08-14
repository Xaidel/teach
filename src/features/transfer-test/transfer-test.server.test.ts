import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type * as runner from '#/lib/sandbox/runner.server'

vi.mock('#/lib/sandbox/runner.server', async (importOriginal) => {
  const actual = await importOriginal<typeof runner>()
  return {
    ...actual,
    runSandboxSubmission: vi.fn(),
  }
})

vi.mock('#/lib/ai/functions.server', () => ({
  generateExercise: vi.fn(),
}))

import { db } from '#/db/client.server'
import {
  attemptHints,
  attempts,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  preFlightAttempts,
  transferTestExercises,
} from '#/db/schema'
import { generateExercise } from '#/lib/ai/functions.server'
import type { GeneratedExercise } from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import type { SandboxResult } from '#/lib/sandbox/types'
import { getCurrentLearnerId } from '#/features/learners/learners.server'
import { advanceMastery } from '#/features/learners/mastery.server'

import {
  generateTransferTestExercise,
  getTransferTestOverview,
} from './transfer-test.server'
import { TransferTestError } from './transfer-test.schema'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()
const generateExerciseMock = vi.mocked(generateExercise)
const runSandboxSubmissionMock = vi.mocked(runSandboxSubmission)

const CONCEPT_SLUG = 'test.transfer_test.target'

const REFERENCE_PASSES: SandboxResult = {
  passed: true,
  tests: [{ name: 'target_test', status: 'passed' }],
}
const BROKEN_FAILS: SandboxResult = {
  passed: false,
  tests: [
    { name: 'target_test', status: 'failed', message: 'assertion failed' },
  ],
}

/** A debug-mode (adversarial) draft targeting the fixture concept. */
const DEBUG_GENERATED: GeneratedExercise = {
  title: 'Fix the off-by-one',
  prompt: 'Find and fix the defect.',
  starterCode: 'pub fn f() -> u32 { 0 }',
  referenceSolution: 'pub fn f() -> u32 { 1 }',
  testSource: '#[test]\nfn target_test() { assert_eq!(exercise::f(), 1); }\n',
  targetConcepts: [CONCEPT_SLUG],
  prerequisites: [],
  difficulty: 2,
  estimatedMinutes: 5,
  constraints: ['std_only'],
  evaluation: {
    tests: ['target_test'],
    rubric: { required: [], prohibited: [], advisory: [] },
  },
  defect: {
    kind: 'other',
    description: 'f returns one less than expected',
    location: 'f',
    expectedBehavior: 'f returns 1',
  },
}

/** An implement-mode draft targeting the fixture concept. */
const IMPLEMENT_GENERATED: GeneratedExercise = {
  ...DEBUG_GENERATED,
  prompt: 'Implement f so it returns 1.',
  defect: undefined,
}

describe.skipIf(!dbUp)('transfer-test.server', () => {
  let learnerId: string
  let conceptId: string

  beforeAll(async () => {
    // ADR-0014: exactly one learner row must hold at all times — the seeded
    // v1 row. This suite must not insert a fixture learner of its own
    // (issue #115); all fixture state below is scoped to its own concept.
    learnerId = await getCurrentLearnerId()

    const [concept] = await db
      .insert(concepts)
      .values({ language: 'rust', slug: CONCEPT_SLUG, difficulty: 2 })
      .returning()
    if (!concept) throw new Error('expected a persisted concept')
    conceptId = concept.id
  })

  afterAll(async () => {
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, conceptId),
        ),
      )
    await db
      .delete(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, conceptId))
    await db.delete(concepts).where(eq(concepts.id, conceptId))
  })

  beforeEach(() => {
    generateExerciseMock.mockReset()
    runSandboxSubmissionMock.mockReset()
  })

  /** Removes every row this suite's generation calls may have written. */
  async function cleanupGenerated(): Promise<void> {
    const rows = await db
      .select({ id: exerciseConcepts.exerciseId })
      .from(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, conceptId))
    const exerciseIds = rows.map((row) => row.id)
    if (exerciseIds.length > 0) {
      const attemptRows = await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(inArray(attempts.exerciseId, exerciseIds))
      const attemptIds = attemptRows.map((row) => row.id)
      if (attemptIds.length > 0) {
        await db
          .delete(attemptHints)
          .where(inArray(attemptHints.attemptId, attemptIds))
      }
      await db.delete(attempts).where(inArray(attempts.exerciseId, exerciseIds))
      await db
        .delete(transferTestExercises)
        .where(eq(transferTestExercises.conceptId, conceptId))
    }
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, conceptId))
    for (const id of exerciseIds) {
      await db.delete(exercises).where(eq(exercises.id, id))
    }
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, conceptId),
        ),
      )
  }

  afterEach(async () => {
    await cleanupGenerated()
  })

  describe('getTransferTestOverview', () => {
    it('omits a concept that has not reached Practiced', async () => {
      const overview = await getTransferTestOverview(learnerId)

      expect(
        overview.concepts.find((c) => c.conceptId === conceptId),
      ).toBeUndefined()
    })

    it('lists a Practiced concept as not yet passed', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')

      const overview = await getTransferTestOverview(learnerId)

      expect(overview.language).toBe('rust')
      expect(
        overview.concepts.find((c) => c.conceptId === conceptId),
      ).toMatchObject({ slug: CONCEPT_SLUG, hasPassedTest: false })
    })

    it('annotates a concept whose Transfer Test already passed', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      generateExerciseMock.mockResolvedValue(DEBUG_GENERATED)
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS)
      const generated = await generateTransferTestExercise({
        learnerId,
        conceptId,
      })
      await db.insert(attempts).values({
        learnerId,
        exerciseId: generated.exerciseId,
        code: 'fixture solution',
        outcome: 'pass',
        timeToSolution: 0,
      })
      const { recordAttemptOutcome } =
        await import('#/features/learners/mastery.server')
      await recordAttemptOutcome(learnerId, generated.exerciseId, true, true)

      const overview = await getTransferTestOverview(learnerId)

      expect(
        overview.concepts.find((c) => c.conceptId === conceptId),
      ).toMatchObject({ hasPassedTest: true })
    })
  })

  describe('generateTransferTestExercise', () => {
    it('rejects a concept that does not exist', async () => {
      await expect(
        generateTransferTestExercise({
          learnerId,
          conceptId: '00000000-0000-7000-8000-000000000000',
        }),
      ).rejects.toThrow(TransferTestError)
    })

    it('rejects a concept the learner has not yet reached Practiced on', async () => {
      await expect(
        generateTransferTestExercise({ learnerId, conceptId }),
      ).rejects.toMatchObject({ code: 'CONCEPT_NOT_ELIGIBLE' })
    })

    it('generates a debug-mode exercise by default (ADR-0010)', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      generateExerciseMock.mockResolvedValue(DEBUG_GENERATED)
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS)

      const result = await generateTransferTestExercise({
        learnerId,
        conceptId,
      })

      expect(result.reused).toBe(false)
      expect(result.conceptSlug).toBe(CONCEPT_SLUG)
      expect(generateExerciseMock.mock.calls[0]?.[0]).toMatchObject({
        adversarial: true,
      })
      const [row] = await db
        .select()
        .from(exercises)
        .where(eq(exercises.id, result.exerciseId))
      expect(row?.mode).toBe('debug')
    })

    it('switches to implement-mode when the learner already passed debug-mode on this concept (AC1)', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      // The learner already reached Practiced via a debug-mode exercise —
      // e.g. through the practice list's own adversarial toggle — solved
      // outside this feature's own generation path entirely.
      const [priorDebugExercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-transfer-test-prior-debug',
          language: 'rust',
          title: 'Prior debug-mode fixture',
          prompt: 'p',
          starterCode: 's',
          mode: 'debug',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!priorDebugExercise) throw new Error('expected a persisted exercise')
      await db
        .insert(exerciseConcepts)
        .values({ exerciseId: priorDebugExercise.id, conceptId })
      await db.insert(attempts).values({
        learnerId,
        exerciseId: priorDebugExercise.id,
        code: 'fixture solution',
        outcome: 'pass',
        timeToSolution: 0,
      })

      generateExerciseMock.mockResolvedValue(IMPLEMENT_GENERATED)
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS)

      const result = await generateTransferTestExercise({
        learnerId,
        conceptId,
      })

      expect(generateExerciseMock.mock.calls[0]?.[0]).toMatchObject({
        adversarial: false,
      })
      const [row] = await db
        .select()
        .from(exercises)
        .where(eq(exercises.id, result.exerciseId))
      expect(row?.mode).toBe('implement')
    })

    it('reuses the already-generated instance on a second call', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      generateExerciseMock.mockResolvedValue(DEBUG_GENERATED)
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS)

      const first = await generateTransferTestExercise({
        learnerId,
        conceptId,
      })
      const second = await generateTransferTestExercise({
        learnerId,
        conceptId,
      })

      expect(second.reused).toBe(true)
      expect(second.exerciseId).toBe(first.exerciseId)
      expect(generateExerciseMock).toHaveBeenCalledTimes(1)
    })

    it('surfaces a generation failure as TRANSFER_TEST_GENERATION_FAILED', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      generateExerciseMock.mockRejectedValue(
        new Error('AI Teacher Engine down'),
      )

      await expect(
        generateTransferTestExercise({ learnerId, conceptId }),
      ).rejects.toMatchObject({ code: 'TRANSFER_TEST_GENERATION_FAILED' })
    })
  })
})
