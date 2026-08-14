import { and, eq, inArray, like, sql } from 'drizzle-orm'
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
  conceptEdges,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  preFlightAttempts,
  transferTestExercises,
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
import {
  advanceMastery,
  getMasteryStates,
  recordExplanationAssessmentOutcome,
  recordTransferTestOutcome,
} from '#/features/learners/mastery.server'
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
// Issue-#15 class-sync fixtures (AC 2/AC 3's Demonstrated-gate evidence):
// fixed slugs under the `rust-test-tactical-%` cleanup prefix, so
// `cleanupFixtures` resolves them by slug — the file's own convention —
// which is what catches a crashed run's residue even when no concept row
// points at these exercises anymore (the concept-join path would only find
// them transitively).
const CLASS_SYNC_EXPLAIN_SLUG = 'rust-test-tactical-class-sync-explain'
const CLASS_SYNC_TRANSFER_SLUG = 'rust-test-tactical-class-sync-transfer'

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
    .delete(transferTestExercises)
    .where(eq(transferTestExercises.exerciseId, exerciseId))
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

/**
 * Runs a full passed Tactical Sprint against the fixture concept and
 * submits its exercise through the real Stage 1 -> Stage 2 pipeline —
 * the sprint-pass shape the issue-#15 AC tests (1-3) share with AC 5.
 */
async function runPassedSprint(): Promise<void> {
  identifySnippetConceptsMock.mockResolvedValue({
    concepts: [{ slug: KNOWN_UNKNOWN_SLUG, description: 'Never attempted.' }],
  })
  generateExerciseMock.mockResolvedValue(generatedFor(KNOWN_UNKNOWN_SLUG))
  runSandboxSubmissionMock
    .mockResolvedValueOnce(REFERENCE_PASSES)
    .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)
    .mockResolvedValueOnce(REFERENCE_PASSES)

  const result = await runTacticalSprint({
    learnerId,
    language: 'rust',
    snippet: 'pub fn f() -> u32 { 0 }',
  })
  expect(result.exercise.kind).toBe('generated')
  if (result.exercise.kind !== 'generated') {
    throw new Error('expected a generated sprint exercise')
  }

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
}

/**
 * Seeds a concept with Class A's full Demonstrated-gate evidence
 * (ADR-0015): a passed Explanation Assessment attempt and a registered
 * Transfer Test exercise, using fixed `rust-test-tactical-class-sync-*`
 * slugs so `cleanupFixtures` removes them after the test (via
 * `deleteExerciseCascade`, which also drops `transfer_test_exercises`).
 */
async function seedClassADemonstratedEvidence(
  conceptId: string,
): Promise<void> {
  const [explainExercise] = await db
    .insert(exercises)
    .values({
      slug: CLASS_SYNC_EXPLAIN_SLUG,
      language: 'rust',
      title: 'Class sync explain fixture',
      prompt: 'Explain the concept in your own words.',
      starterCode: '',
      mode: 'explain',
      difficulty: 1,
      status: 'verified',
    })
    .returning()
  if (!explainExercise) throw new Error('expected the explain fixture')
  await db
    .insert(exerciseConcepts)
    .values({ exerciseId: explainExercise.id, conceptId })
  await db.insert(attempts).values({
    learnerId,
    exerciseId: explainExercise.id,
    code: 'fixture explanation',
    timeToSolution: 0,
    explanationAssessment: {
      accuracyScore: 0.8,
      analysis: { missing: [], incorrect: [], conflated: [] },
    },
  })

  const [transferExercise] = await db
    .insert(exercises)
    .values({
      slug: CLASS_SYNC_TRANSFER_SLUG,
      language: 'rust',
      title: 'Class sync transfer fixture',
      prompt: 'p',
      starterCode: 's',
      mode: 'debug',
      difficulty: 1,
      status: 'verified',
    })
    .returning()
  if (!transferExercise) throw new Error('expected the transfer fixture')
  await db
    .insert(exerciseConcepts)
    .values({ exerciseId: transferExercise.id, conceptId })
  await db.insert(transferTestExercises).values({
    learnerId,
    conceptId,
    exerciseId: transferExercise.id,
    // ADR-0027: `hasPassedTransferTest` reads the durable `passed` flag
    // (default false) — seed it true so the AC 2 discriminator can fail a
    // bare `promoteToDemonstrated` creep on the sprint path.
    passed: true,
  })
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

    it('targets a concept whose Class A curriculum prerequisites are not Practiced, without throwing (issue #14 Round 3)', async () => {
      const rootSlug = 'test.tactical.sprint.root'
      const gatedSlug = 'test.tactical.sprint.gated'

      const [rootConcept] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: rootSlug, difficulty: 1 })
        .returning()
      const [gatedConcept] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: gatedSlug, difficulty: 3 })
        .returning()
      if (!rootConcept || !gatedConcept) {
        throw new Error('expected the gate fixture concepts')
      }
      await db.insert(conceptEdges).values({
        fromConceptId: rootConcept.id,
        toConceptId: gatedConcept.id,
        kind: 'prerequisite',
      })

      try {
        // No mastery row for the root: `gatedSlug` is locked in the Class A
        // curriculum. `generateExerciseForConcept` rejects this exact shape
        // with PREREQUISITES_NOT_PRACTICED for a non-sprint caller (see
        // exercise-generation.server.test.ts's AC4 tests) — Tactical Sprint
        // must not, since Class B is exempt by design (SPEC story 8).
        identifySnippetConceptsMock.mockResolvedValue({
          concepts: [{ slug: gatedSlug, description: 'Seen in the wild.' }],
        })
        generateExerciseMock.mockResolvedValue(generatedFor(gatedSlug))
        runSandboxSubmissionMock
          .mockResolvedValueOnce(REFERENCE_PASSES)
          .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

        const result = await runTacticalSprint({
          learnerId,
          language: 'rust',
          snippet: 'pub fn f() -> u32 { 0 }',
        })

        expect(result.targetConceptSlug).toBe(gatedSlug)
        expect(result.exercise.kind).toBe('generated')
        if (result.exercise.kind !== 'generated') {
          return
        }

        // The exercise it just generated is itself submittable, despite the
        // lock — the same exemption applies to submission (issue #14
        // Round 3), so the sprint's own exercise isn't a dead end. The
        // sprint fixture's rubric has no criteria, so an empty verdict set
        // is a trivial Stage 2 pass.
        runSandboxSubmissionMock.mockReset()
        runSandboxSubmissionMock.mockResolvedValue(REFERENCE_PASSES)
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

        await deleteExerciseCascade(result.exercise.exercise.id)
      } finally {
        await db
          .delete(learnerConceptMastery)
          .where(
            and(
              eq(learnerConceptMastery.learnerId, learnerId),
              inArray(learnerConceptMastery.conceptId, [
                rootConcept.id,
                gatedConcept.id,
              ]),
            ),
          )
        await db
          .delete(conceptEdges)
          .where(
            and(
              eq(conceptEdges.fromConceptId, rootConcept.id),
              eq(conceptEdges.toConceptId, gatedConcept.id),
              eq(conceptEdges.kind, 'prerequisite'),
            ),
          )
        await db
          .delete(preFlightAttempts)
          .where(
            inArray(preFlightAttempts.conceptId, [
              rootConcept.id,
              gatedConcept.id,
            ]),
          )
        await db.delete(concepts).where(eq(concepts.id, rootConcept.id))
        await db.delete(concepts).where(eq(concepts.id, gatedConcept.id))
      }
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

    it('picks a matched concept over an unmatched one on an unknown tie, triggering no draft (issue #128)', async () => {
      const [knownRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 2 })
        .returning()
      if (!knownRow) throw new Error('expected the fixture concept row')

      identifySnippetConceptsMock.mockResolvedValue({
        concepts: [
          { slug: KNOWN_UNKNOWN_SLUG, description: 'Already known.' },
          { slug: UNMATCHED_SLUG, description: 'A concept new to this graph.' },
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

      // Both tie at `unknown` (the lowest rank); the first-identified —
      // matched — candidate wins the tie-break, so the sprint never drafts.
      expect(result.targetConceptSlug).toBe(KNOWN_UNKNOWN_SLUG)
      expect(draftConceptGraphMock).not.toHaveBeenCalled()

      const winnerView = result.identifiedConcepts.find(
        (concept) => concept.slug === KNOWN_UNKNOWN_SLUG,
      )
      const loserView = result.identifiedConcepts.find(
        (concept) => concept.slug === UNMATCHED_SLUG,
      )
      expect(winnerView).toMatchObject({
        matched: true,
        conceptId: knownRow.id,
        masteryState: 'unknown',
      })
      expect(loserView).toMatchObject({
        matched: false,
        conceptId: undefined,
        masteryState: 'unknown',
      })

      const generateCall = generateExerciseMock.mock.calls[0]?.[0]
      expect(generateCall).toMatchObject({
        conceptSlug: KNOWN_UNKNOWN_SLUG,
        sprintScoped: true,
      })
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

    it('a passed Class B sprint grants at least Practiced toward the matching Class A concept (AC 1)', async () => {
      const [conceptRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 2 })
        .returning()
      if (!conceptRow) throw new Error('expected the fixture concept row')

      await runPassedSprint()

      await expect(
        getMasteryStates(learnerId, [conceptRow.id]),
      ).resolves.toEqual({ [conceptRow.id]: 'practiced' })
    })

    it('a Class B completion alone never advances a concept beyond Practiced (AC 2)', async () => {
      const [conceptRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 2 })
        .returning()
      if (!conceptRow) throw new Error('expected the fixture concept row')
      // The concept is already Practiced from Class A *with its full
      // Demonstrated-gate evidence in place* — a passed Explanation
      // Assessment attempt and a Transfer Test row whose durable `passed`
      // flag is seeded true. If the sprint path ever wrongly promoted, the
      // evidence would be there to promote off of, so the "never beyond
      // Practiced" assertion below is discriminating (issue #15 AC 2): a
      // promotion-creep implementation becomes Demonstrated and fails.
      await advanceMastery(learnerId, [conceptRow.id], 'practiced')
      await seedClassADemonstratedEvidence(conceptRow.id)

      await runPassedSprint()

      // Never beyond Practiced, and never regressed from it.
      await expect(
        getMasteryStates(learnerId, [conceptRow.id]),
      ).resolves.toEqual({ [conceptRow.id]: 'practiced' })
    })

    it('Class A’s own progression still applies on top of a Class-B-granted Practiced state (AC 3)', async () => {
      const [conceptRow] = await db
        .insert(concepts)
        .values({ language: 'rust', slug: KNOWN_UNKNOWN_SLUG, difficulty: 2 })
        .returning()
      if (!conceptRow) throw new Error('expected the fixture concept row')

      // First, a passed Class B sprint grants Practiced toward the concept.
      await runPassedSprint()
      await expect(
        getMasteryStates(learnerId, [conceptRow.id]),
      ).resolves.toEqual({ [conceptRow.id]: 'practiced' })

      // Then Class A's own evidence (passed Explanation Assessment + passed
      // Transfer Test) must still promote the concept off the sync-granted
      // Practiced state — the sync never owns the concept's state beyond
      // Practiced. `cleanupFixtures` removes the evidence rows afterwards.
      await seedClassADemonstratedEvidence(conceptRow.id)
      await recordExplanationAssessmentOutcome({
        learnerId,
        conceptId: conceptRow.id,
        passed: true,
      })
      await recordTransferTestOutcome({
        learnerId,
        conceptId: conceptRow.id,
        passed: true,
      })

      await expect(
        getMasteryStates(learnerId, [conceptRow.id]),
      ).resolves.toEqual({ [conceptRow.id]: 'demonstrated' })
    })
  },
)
