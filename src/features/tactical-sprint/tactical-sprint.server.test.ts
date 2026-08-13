import { eq, inArray, like, sql } from 'drizzle-orm'
import {
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
  identifySnippetConcepts: vi.fn(),
  draftConceptGraph: vi.fn(),
  generateExercise: vi.fn(),
  reviewSubmission: vi.fn(),
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
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import {
  draftConceptGraph,
  generateExercise,
  identifySnippetConcepts,
  reviewSubmission,
} from '#/lib/ai/functions.server'
import type { GeneratedExercise } from '#/lib/ai/schemas'
import { submitExercise } from '#/features/exercise/exercise.server'
import { getCurrentLearnerId } from '#/features/learners/learners.server'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import type { SandboxResult } from '#/lib/sandbox/types'

import { runTacticalSprint } from './tactical-sprint.server'
import { TacticalSprintError } from './tactical-sprint.schema'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()
const identifySnippetConceptsMock = vi.mocked(identifySnippetConcepts)
const draftConceptGraphMock = vi.mocked(draftConceptGraph)
const generateExerciseMock = vi.mocked(generateExercise)
const reviewSubmissionMock = vi.mocked(reviewSubmission)
const runSandboxSubmissionMock = vi.mocked(runSandboxSubmission)

const KNOWN_PRACTICED_SLUG = 'test.tactical.known_practiced'
const KNOWN_UNKNOWN_SLUG = 'test.tactical.known_unknown'
const UNMATCHED_SLUG = 'test.tactical.unmatched'
const UNMATCHED_LOSING_SLUG = 'test.tactical.unmatched_losing'
const TEST_SLUGS = [
  KNOWN_PRACTICED_SLUG,
  KNOWN_UNKNOWN_SLUG,
  UNMATCHED_SLUG,
  UNMATCHED_LOSING_SLUG,
]

const REFERENCE_PASSES: SandboxResult = {
  passed: true,
  tests: [{ name: 'sprint_test', status: 'passed' }],
}
const BROKEN_FAILS_ON_CONCEPT: SandboxResult = {
  passed: false,
  tests: [
    { name: 'sprint_test', status: 'failed', message: 'assertion failed' },
  ],
}

/** A sprint-scoped generated exercise: 5-10 minute estimate (ticket #13). */
function generatedFor(conceptSlug: string): GeneratedExercise {
  return {
    title: 'Fix the borrow',
    prompt: 'Fill in the body so the tests pass.',
    starterCode: 'pub fn f() -> u32 { 0 }',
    referenceSolution: 'pub fn f() -> u32 { 1 }',
    testSource: '#[test]\nfn sprint_test() { assert_eq!(exercise::f(), 1); }\n',
    targetConcepts: [conceptSlug],
    prerequisites: [],
    difficulty: 2,
    estimatedMinutes: 7,
    constraints: ['std_only', 'preserve_signature'],
    evaluation: {
      tests: ['sprint_test'],
      rubric: { required: [], prohibited: [], advisory: [] },
    },
  }
}

let learnerId: string

beforeAll(async () => {
  if (!dbUp) return
  // Clean up first: a crashed prior run's leftovers are resolved by slug,
  // same as the e2e fixtures' own convention.
  await cleanupFixtures()
  // ADR-0014: exactly one learner row must hold at all times — the seeded
  // v1 row. This suite must not insert a fixture learner of its own: a
  // second row would transiently break every other DB suite's
  // `getCurrentLearnerId()` call running concurrently in the same process
  // (issue #115, PR #119's root-cause fix — mirrored here). All fixture
  // state below is scoped to this suite's own concept/exercise slugs
  // instead, cleaned up by that scope in `afterEach`.
  learnerId = await getCurrentLearnerId()
})

beforeEach(() => {
  identifySnippetConceptsMock.mockReset()
  draftConceptGraphMock.mockReset()
  generateExerciseMock.mockReset()
  reviewSubmissionMock.mockReset()
  runSandboxSubmissionMock.mockReset()
})

/** Fully removes one exercise row, cascading through its dependents. */
async function deleteExerciseCascade(exerciseId: string): Promise<void> {
  const exerciseAttempts = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(eq(attempts.exerciseId, exerciseId))
  for (const attempt of exerciseAttempts) {
    await db.delete(attemptHints).where(eq(attemptHints.attemptId, attempt.id))
  }
  await db.delete(attempts).where(eq(attempts.exerciseId, exerciseId))
  await db
    .delete(exerciseConcepts)
    .where(eq(exerciseConcepts.exerciseId, exerciseId))
  await db.delete(exercises).where(eq(exercises.id, exerciseId))
}

/**
 * Removes every row this suite owns, resolved by slug so a crashed run's
 * leftovers are found and removed on the next run too (mirrors the e2e
 * fixtures' own cleanup-by-slug convention).
 */
async function cleanupFixtures(): Promise<void> {
  const generatedRows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(like(exercises.slug, 'rust-test-tactical-%'))
  for (const row of generatedRows) {
    await deleteExerciseCascade(row.id)
  }

  const conceptRows = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(inArray(concepts.slug, TEST_SLUGS))
  const conceptIds = conceptRows.map((row) => row.id)
  if (conceptIds.length === 0) return

  await db
    .delete(learnerConceptMastery)
    .where(inArray(learnerConceptMastery.conceptId, conceptIds))
  await db
    .delete(preFlightAttempts)
    .where(inArray(preFlightAttempts.conceptId, conceptIds))
  const remainingExerciseIds = await db
    .select({ id: exerciseConcepts.exerciseId })
    .from(exerciseConcepts)
    .where(inArray(exerciseConcepts.conceptId, conceptIds))
  for (const row of remainingExerciseIds) {
    await deleteExerciseCascade(row.id)
  }
  await db.delete(concepts).where(inArray(concepts.id, conceptIds))
}

afterEach(async () => {
  if (!dbUp) return
  await cleanupFixtures()
})

describe.skipIf(!dbUp)(
  'runTacticalSprint against Postgres (ticket #13)',
  () => {
    it('targets the mastery-weakest of two known concepts and generates a sprint-scoped exercise', async () => {
      const [practicedRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_PRACTICED_SLUG, difficulty: 2 })
        .returning()
      const [unknownRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 3 })
        .returning()
      if (!practicedRow || !unknownRow) {
        throw new Error('expected the fixture concept rows')
      }
      await db.insert(learnerConceptMastery).values({
        learnerId,
        conceptId: practicedRow.id,
        state: 'practiced',
      })

      identifySnippetConceptsMock.mockResolvedValue({
        concepts: [
          { slug: KNOWN_PRACTICED_SLUG, description: 'Already comfortable.' },
          { slug: KNOWN_UNKNOWN_SLUG, description: 'Never attempted.' },
        ],
      })
      generateExerciseMock.mockResolvedValue(generatedFor(KNOWN_UNKNOWN_SLUG))
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

      const result = await runTacticalSprint({
        learnerId,
        language: 'rust',
        snippet: 'pub fn f() -> u32 { 0 }',
      })

      // Unknown ranks weaker than practiced (SPEC story 5) — it's the target,
      // never the already-practiced concept.
      expect(result.targetConceptSlug).toBe(KNOWN_UNKNOWN_SLUG)
      expect(result.identifiedConcepts).toHaveLength(2)
      const practicedView = result.identifiedConcepts.find(
        (concept) => concept.slug === KNOWN_PRACTICED_SLUG,
      )
      const unknownView = result.identifiedConcepts.find(
        (concept) => concept.slug === KNOWN_UNKNOWN_SLUG,
      )
      expect(practicedView).toMatchObject({
        matched: true,
        masteryState: 'practiced',
      })
      expect(unknownView).toMatchObject({
        matched: true,
        masteryState: 'unknown',
      })

      expect(result.exercise.kind).toBe('generated')
      if (result.exercise.kind !== 'generated') {
        return
      }
      expect(result.exercise.estimatedMinutes).toBeGreaterThanOrEqual(5)
      expect(result.exercise.estimatedMinutes).toBeLessThanOrEqual(10)

      // The identification step was given the graph's known slugs, and
      // generation was told this is a sprint targeting the weakest concept.
      const identifyCall = identifySnippetConceptsMock.mock.calls[0]?.[0]
      expect(identifyCall?.knownConceptSlugs).toEqual(
        expect.arrayContaining([KNOWN_PRACTICED_SLUG, KNOWN_UNKNOWN_SLUG]),
      )
      const generateCall = generateExerciseMock.mock.calls[0]?.[0]
      expect(generateCall).toMatchObject({
        conceptSlug: KNOWN_UNKNOWN_SLUG,
        sprintScoped: true,
      })
    })

    it('ad-hoc drafts an unmatched identified concept and uses it immediately (ADR-0016 runtime gap)', async () => {
      identifySnippetConceptsMock.mockResolvedValue({
        concepts: [
          {
            slug: UNMATCHED_SLUG,
            description: 'A concept new to this graph.',
          },
        ],
      })
      draftConceptGraphMock.mockResolvedValue({
        concepts: [{ slug: UNMATCHED_SLUG, difficulty: 3 }],
        edges: [],
      })
      generateExerciseMock.mockResolvedValue(generatedFor(UNMATCHED_SLUG))
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

      const result = await runTacticalSprint({
        learnerId,
        language: 'rust',
        snippet: 'pub fn f() -> u32 { 0 }',
      })

      expect(result.targetConceptSlug).toBe(UNMATCHED_SLUG)
      expect(result.identifiedConcepts).toEqual([
        expect.objectContaining({ slug: UNMATCHED_SLUG, matched: false }),
      ])

      const draftCall = draftConceptGraphMock.mock.calls[0]?.[0]
      expect(draftCall).toEqual({
        language: 'rust',
        focusConcept: {
          slug: UNMATCHED_SLUG,
          description: 'A concept new to this graph.',
        },
      })

      const [persisted] = await db
        .select()
        .from(concepts)
        .where(eq(concepts.slug, UNMATCHED_SLUG))
      expect(persisted?.status).toBe('draft')
      expect(persisted?.difficulty).toBe(3)
    })

    it('drafts only the weakest of two unmatched identified concepts, leaving the loser undrafted (issue #125)', async () => {
      identifySnippetConceptsMock.mockResolvedValue({
        concepts: [
          { slug: UNMATCHED_SLUG, description: 'The tie-break winner.' },
          { slug: UNMATCHED_LOSING_SLUG, description: 'Never drafted.' },
        ],
      })
      draftConceptGraphMock.mockResolvedValue({
        concepts: [{ slug: UNMATCHED_SLUG, difficulty: 3 }],
        edges: [],
      })
      generateExerciseMock.mockResolvedValue(generatedFor(UNMATCHED_SLUG))
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

      const result = await runTacticalSprint({
        learnerId,
        language: 'rust',
        snippet: 'pub fn f() -> u32 { 0 }',
      })

      // Both unmatched candidates tie at `unknown` (the lowest rank); the
      // first-identified one wins the tie-break and is the only one drafted.
      expect(result.targetConceptSlug).toBe(UNMATCHED_SLUG)
      expect(draftConceptGraphMock).toHaveBeenCalledTimes(1)
      expect(draftConceptGraphMock.mock.calls[0]?.[0]).toEqual({
        language: 'rust',
        focusConcept: {
          slug: UNMATCHED_SLUG,
          description: 'The tie-break winner.',
        },
      })

      const winnerView = result.identifiedConcepts.find(
        (concept) => concept.slug === UNMATCHED_SLUG,
      )
      const loserView = result.identifiedConcepts.find(
        (concept) => concept.slug === UNMATCHED_LOSING_SLUG,
      )
      expect(winnerView).toMatchObject({
        matched: false,
        masteryState: 'unknown',
      })
      expect(typeof winnerView?.conceptId).toBe('string')
      expect(loserView).toMatchObject({
        matched: false,
        conceptId: undefined,
        masteryState: 'unknown',
      })

      const [losingRow] = await db
        .select()
        .from(concepts)
        .where(eq(concepts.slug, UNMATCHED_LOSING_SLUG))
      expect(losingRow).toBeUndefined()
    })

    it('collapses duplicate identified slugs into one candidate', async () => {
      const [conceptRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 2 })
        .returning()
      if (!conceptRow) throw new Error('expected the fixture concept row')

      identifySnippetConceptsMock.mockResolvedValue({
        concepts: [
          { slug: KNOWN_UNKNOWN_SLUG, description: 'first mention' },
          { slug: KNOWN_UNKNOWN_SLUG, description: 'second mention' },
        ],
      })
      generateExerciseMock.mockResolvedValue(generatedFor(KNOWN_UNKNOWN_SLUG))
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES)
        .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

      const result = await runTacticalSprint({
        learnerId,
        language: 'rust',
        snippet: 'pub fn f() -> u32 { 0 }',
      })

      expect(result.identifiedConcepts).toHaveLength(1)
    })

    it('maps a snippet analysis failure to a stable error without touching the graph or generation', async () => {
      identifySnippetConceptsMock.mockRejectedValue(
        new TeacherEngineError('api_error', 'engine unreachable'),
      )

      await expect(
        runTacticalSprint({
          learnerId,
          language: 'rust',
          snippet: 'pub fn f() -> u32 { 0 }',
        }),
      ).rejects.toBeInstanceOf(TacticalSprintError)
      await expect(
        runTacticalSprint({
          learnerId,
          language: 'rust',
          snippet: 'pub fn f() -> u32 { 0 }',
        }),
      ).rejects.toMatchObject({ code: 'SNIPPET_ANALYSIS_FAILED' })

      expect(draftConceptGraphMock).not.toHaveBeenCalled()
      expect(generateExerciseMock).not.toHaveBeenCalled()
    })

    it('produces a normal exercise a learner can submit through the full Stage 1 pipeline, advancing the Learner Model (AC 5)', async () => {
      await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 2 })

      identifySnippetConceptsMock.mockResolvedValue({
        concepts: [
          { slug: KNOWN_UNKNOWN_SLUG, description: 'Never attempted.' },
        ],
      })
      generateExerciseMock.mockResolvedValue(generatedFor(KNOWN_UNKNOWN_SLUG))
      runSandboxSubmissionMock
        .mockResolvedValueOnce(REFERENCE_PASSES) // Pre-Flight: reference
        .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT) // Pre-Flight: broken
        .mockResolvedValueOnce(REFERENCE_PASSES) // the learner's own passing submission

      const result = await runTacticalSprint({
        learnerId,
        language: 'rust',
        snippet: 'pub fn f() -> u32 { 0 }',
      })
      expect(result.exercise.kind).toBe('generated')
      if (result.exercise.kind !== 'generated') {
        return
      }

      // The fixture rubric has no required/prohibited/advisory criteria — an
      // empty entry-for-entry verdict mirrors it (issue #6's contract).
      reviewSubmissionMock.mockResolvedValue({
        required: [],
        prohibited: [],
        advisory: [],
      })

      const submission = await submitExercise({
        exerciseId: result.exercise.exercise.id,
        code: 'pub fn f() -> u32 { 1 }',
        learnerId,
      })

      expect(submission.result.passed).toBe(true)

      const [mastery] = await db
        .select({ state: learnerConceptMastery.state })
        .from(learnerConceptMastery)
        .innerJoin(concepts, eq(concepts.id, learnerConceptMastery.conceptId))
        .where(
          sql`${concepts.slug} = ${KNOWN_UNKNOWN_SLUG} and ${learnerConceptMastery.learnerId} = ${learnerId}`,
        )
      expect(mastery?.state).toBe('practiced')
    })
  },
)
