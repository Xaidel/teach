import { and, eq, inArray, like, or, sql } from 'drizzle-orm'
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
  conceptEdges,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  preFlightAttempts,
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateExercise } from '#/lib/ai/functions.server'
import type { GeneratedExercise } from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import type { SandboxResult } from '#/lib/sandbox/types'

import { generateExerciseForConcept } from './exercise-generation.server'
import { getAvailableExercises } from './exercise.server'
import { getCurrentLearnerId } from '../learners/learners.server'
import { advanceMastery } from '../learners/mastery.server'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()
const runSandboxSubmissionMock = vi.mocked(runSandboxSubmission)
const generateExerciseMock = vi.mocked(generateExercise)

let learnerId: string

const FIXTURE_CONCEPT_SLUG = 'test.rust.borrowing'
const FIXTURE_CONCEPT_ID = '33333333-3333-7333-8333-333333333333'

/** The fixture's direct prerequisite, used by the no-skip-ahead gate tests. */
const FIXTURE_ROOT_SLUG = 'test.rust.references'
const FIXTURE_ROOT_ID = '33333333-3333-7333-8333-333333333332'

/** A fully-formed generated exercise for the fixture concept. */
const GENERATED: GeneratedExercise = {
  title: 'Borrow or move?',
  prompt:
    'Implement `first(v: &Vec<u32>) -> u32` returning the first element, borrowing rather than consuming the vector.',
  starterCode: 'pub fn first(v: Vec<u32>) -> u32 {\n    v[0]\n}\n',
  referenceSolution: 'pub fn first(v: &Vec<u32>) -> u32 {\n    v[0]\n}\n',
  testSource: `#[test]
fn borrows_its_argument() {
    let v = vec![1, 2];
    assert_eq!(exercise::first(&v), 1);
    assert_eq!(v.len(), 2, "the vector must not be consumed");
}
`,
  targetConcepts: [FIXTURE_CONCEPT_SLUG],
  prerequisites: ['test.rust.references'],
  difficulty: 2,
  estimatedMinutes: 8,
  constraints: ['std_only'],
  evaluation: {
    tests: ['borrows_its_argument'],
    rubric: {
      required: ['Takes the vector by reference'],
      prohibited: ['Consumes the vector with into_iter or indexing by value'],
      advisory: ['Keeps the body to a single expression'],
    },
  },
}

const REFERENCE_PASSES: SandboxResult = {
  passed: true,
  tests: [{ name: 'borrows_its_argument', status: 'passed' }],
}

/**
 * An adversarial (debug-mode) draft of the same fixture exercise: the same
 * code, but the starterCode defect is declared — it consumes the vector —
 * and the learner-facing prompt frames the debugging task (SPEC story 51,
 * issue #11).
 */
const ADVERSARIAL_GENERATED: GeneratedExercise = {
  ...GENERATED,
  prompt:
    'The function `first(v: Vec<u32>)` contains a defect: it consumes the vector instead of borrowing it. Find the defect and fix it so the vector is still usable after the call.',
  defect: {
    kind: 'ownership',
    description: 'first consumes the vector instead of borrowing it',
    location: 'first',
    expectedBehavior:
      'first returns the first element while leaving the vector usable',
  },
}

const BROKEN_FAILS_ON_CONCEPT: SandboxResult = {
  passed: false,
  tests: [
    {
      name: 'borrows_its_argument',
      status: 'failed',
      message: 'assertion failed: v.len() == 2',
    },
  ],
}

/** The reference solution fails to compile and pass its tests. */
const REFERENCE_FAILS: SandboxResult = {
  passed: false,
  tests: [],
  message: 'reference solution does not compile',
}

/** The intended broken state does not fail. */
const BROKEN_PASSES: SandboxResult = {
  passed: true,
  tests: [{ name: 'borrows_its_argument', status: 'passed' }],
}

/** The intended broken state fails only an unrelated, undeclared test. */
const BROKEN_FAILS_UNRELATED: SandboxResult = {
  passed: false,
  tests: [
    {
      name: 'an_unrelated_test',
      status: 'failed',
      message: 'assertion failed',
    },
  ],
}

/**
 * The seeded fallback exercise's stored ADR-0019 artifacts. Deliberately
 * distinct from `GENERATED.testSource` / `GENERATED.referenceSolution` so a
 * test can prove the served verified exercise reuses its *stored* harness
 * and solution rather than a regenerated draft's.
 */
const FALLBACK_TEST_SOURCE = '#[test]\nfn works() { assert!(true); }\n'
const FALLBACK_REFERENCE_SOLUTION = 'pub fn seeded() {}'

/** Schedules the sandbox mocks for one failing pre-flight run. */
function scheduleFailingPreFlight(
  sequence: [SandboxResult, SandboxResult],
): void {
  runSandboxSubmissionMock
    .mockResolvedValueOnce(sequence[0])
    .mockResolvedValueOnce(sequence[1])
}

beforeAll(async () => {
  learnerId = await getCurrentLearnerId()
  await db.insert(concepts).values({
    id: FIXTURE_CONCEPT_ID,
    language: 'rust',
    slug: FIXTURE_CONCEPT_SLUG,
    difficulty: 2,
  })
  await db.insert(concepts).values({
    id: FIXTURE_ROOT_ID,
    language: 'rust',
    slug: FIXTURE_ROOT_SLUG,
    difficulty: 1,
  })
})

beforeEach(() => {
  runSandboxSubmissionMock.mockReset()
  generateExerciseMock.mockReset()
})

/** Removes every row the generation flow writes for the fixture concept. */
async function cleanupGeneratedRows(): Promise<void> {
  const slugs = await db
    .select({ slug: exercises.slug })
    .from(exercises)
    .where(like(exercises.slug, 'rust-test-rust-borrowing-%'))
  await db
    .delete(exerciseConcepts)
    .where(eq(exerciseConcepts.conceptId, FIXTURE_CONCEPT_ID))
  await db
    .delete(preFlightAttempts)
    .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
  for (const row of slugs) {
    await db.delete(exercises).where(eq(exercises.slug, row.slug))
  }
  // Scoped to this suite's fixture concepts: the seeded learner is shared
  // with other DB suites (issue #115), and a learner-wide delete would
  // clobber their mastery rows under file-parallel execution.
  await db
    .delete(learnerConceptMastery)
    .where(
      and(
        eq(learnerConceptMastery.learnerId, learnerId),
        inArray(learnerConceptMastery.conceptId, [
          FIXTURE_CONCEPT_ID,
          FIXTURE_ROOT_ID,
        ]),
      ),
    )
  await db
    .delete(conceptEdges)
    .where(
      or(
        eq(conceptEdges.fromConceptId, FIXTURE_CONCEPT_ID),
        eq(conceptEdges.toConceptId, FIXTURE_CONCEPT_ID),
        eq(conceptEdges.fromConceptId, FIXTURE_ROOT_ID),
        eq(conceptEdges.toConceptId, FIXTURE_ROOT_ID),
      ),
    )
}

afterEach(async () => {
  await cleanupGeneratedRows()
})

afterAll(async () => {
  await db.delete(concepts).where(eq(concepts.slug, FIXTURE_CONCEPT_SLUG))
  await db.delete(concepts).where(eq(concepts.slug, FIXTURE_ROOT_SLUG))
})

describe.skipIf(!dbUp)('exercise generation against Postgres', () => {
  it('persists a verified exercise with its concepts and the pre-flight log on success', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.exercise.title).toBe('Borrow or move?')
    expect(outcome.exercise.language).toBe('rust')
    expect(outcome.targetConcepts).toEqual([FIXTURE_CONCEPT_SLUG])
    expect(outcome.prerequisites).toEqual(GENERATED.prerequisites)
    expect(outcome.estimatedMinutes).toBe(GENERATED.estimatedMinutes)
    expect(outcome.simplified).toBe(false)
    expect(outcome.preflight).toEqual({
      attemptNumber: 1,
      passed: true,
      checks: [
        { name: 'reference_passes', passed: true },
        { name: 'broken_state_fails', passed: true },
        { name: 'failure_matches_concept', passed: true },
      ],
    })

    const aiCall = generateExerciseMock.mock.calls[0]?.[0]
    expect(aiCall).toMatchObject({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      conceptDifficulty: 2,
    })
    // A first attempt is never fed previous diagnostics.
    expect(aiCall?.previousDiagnostics).toBeUndefined()
    expect(aiCall?.simplifiedConstraints).toBe(false)

    const sandboxCalls = runSandboxSubmissionMock.mock.calls.map(
      ([call]) => call,
    )
    expect(sandboxCalls).toHaveLength(2)
    expect(sandboxCalls[0]).toMatchObject({
      language: 'rust',
      code: GENERATED.referenceSolution,
      testSource: GENERATED.testSource,
    })
    expect(sandboxCalls[1]).toMatchObject({
      language: 'rust',
      code: GENERATED.starterCode,
      testSource: GENERATED.testSource,
    })

    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row).toMatchObject({
      mode: 'implement',
      difficulty: 2,
      constraints: ['std_only'],
      referenceSolution: GENERATED.referenceSolution,
      testSource: GENERATED.testSource,
      status: 'verified',
    })
    expect(row?.evaluationRubric).toEqual(GENERATED.evaluation.rubric)

    const [join] = await db
      .select()
      .from(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, outcome.exercise.id))
    expect(join?.conceptId).toBe(FIXTURE_CONCEPT_ID)

    const [attempt] = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempt?.attemptNumber).toBe(1)
    expect(attempt?.passed).toBe(true)
    expect(attempt?.diagnostics.checks).toHaveLength(3)
  })

  it('persists the declared sample tests through to the client-facing exercise', async () => {
    const sampleTests = [{ input: 'first(&vec![1, 2])', expected: '1' }]
    generateExerciseMock.mockResolvedValue({ ...GENERATED, sampleTests })
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    // Reaches the client through the same shared mapper both `/practice`
    // and the Class A step page use.
    expect(outcome.exercise.sampleTests).toEqual(sampleTests)

    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row?.sampleTests).toEqual(sampleTests)
  })

  it('persists an independent exercise with guidance=independent (issue #14)', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      guidance: 'independent',
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.exercise.guidance).toBe('independent')

    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row).toMatchObject({ mode: 'implement', guidance: 'independent' })
  })

  it("feeds the failed attempt's diagnostics into the retry and persists on the second attempt", async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    // Attempt 1: the reference solution fails to compile.
    scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    // Attempt 2: the regenerated exercise passes every check.
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.attemptNumber).toBe(2)

    // The retry received the attempt-1 failure's structured diagnostics.
    expect(generateExerciseMock).toHaveBeenCalledTimes(2)
    const retryInput = generateExerciseMock.mock.calls[1]?.[0]
    expect(retryInput?.previousDiagnostics).toMatchObject({
      checks: [
        { name: 'reference_passes', passed: false },
        { name: 'broken_state_fails', passed: true },
        { name: 'failure_matches_concept', passed: true },
      ],
      referenceResult: { passed: false },
    })
    expect(retryInput?.simplifiedConstraints).toBe(false)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      passed: false,
    })
    expect(attempts[0]?.diagnostics.checks[0]).toMatchObject({
      name: 'reference_passes',
      passed: false,
    })
    expect(attempts[1]).toMatchObject({
      attemptNumber: 2,
      passed: true,
    })
  })

  it('retries when the intended broken state does not fail', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    scheduleFailingPreFlight([REFERENCE_PASSES, BROKEN_PASSES])
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.attemptNumber).toBe(2)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      passed: false,
    })
    expect(attempts[0]?.diagnostics.checks[1]).toMatchObject({
      name: 'broken_state_fails',
      passed: false,
    })
    expect(attempts[1]?.passed).toBe(true)
  })

  it('retries when the broken state fails only unrelated tests', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    scheduleFailingPreFlight([REFERENCE_PASSES, BROKEN_FAILS_UNRELATED])
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.attemptNumber).toBe(2)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts[0]?.diagnostics.checks[2]).toMatchObject({
      name: 'failure_matches_concept',
      passed: false,
    })
  })

  it('retries a failing test whose name is declared but not defined in the harness (issue #89)', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      evaluation: {
        tests: ['borrows_its_argument', 'padded_never_defined'],
        rubric: GENERATED.evaluation.rubric,
      },
    })
    scheduleFailingPreFlight([
      REFERENCE_PASSES,
      {
        passed: false,
        tests: [
          {
            name: 'padded_never_defined',
            status: 'failed',
            message: 'assertion failed',
          },
        ],
      },
    ])
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.attemptNumber).toBe(2)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts[0]?.diagnostics.checks[2]).toMatchObject({
      name: 'failure_matches_concept',
      passed: false,
    })
  })

  it('still accepts a failing test that is declared and defined in the harness alongside a padded name (issue #89)', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      evaluation: {
        tests: ['borrows_its_argument', 'padded_never_defined'],
        rubric: GENERATED.evaluation.rubric,
      },
    })
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.passed).toBe(true)
  })

  it('persists an adversarial exercise as debug mode with the declared defect', async () => {
    generateExerciseMock.mockResolvedValue(ADVERSARIAL_GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      adversarial: true,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    // The generation contract carries the known defect: kind, description,
    // location, and the expected behavior of the fix (SPEC story 52).
    expect(outcome.defect).toEqual(ADVERSARIAL_GENERATED.defect)

    const aiCall = generateExerciseMock.mock.calls[0]?.[0]
    expect(aiCall).toMatchObject({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      conceptDifficulty: 2,
      adversarial: true,
    })

    // The adversarial gate is the exact same Pre-Flight gate as any other
    // exercise: one reference run and one broken-state run against the
    // same test harness, no extra checks.
    const sandboxCalls = runSandboxSubmissionMock.mock.calls.map(
      ([call]) => call,
    )
    expect(sandboxCalls).toHaveLength(2)
    expect(sandboxCalls[0]).toMatchObject({
      language: 'rust',
      code: ADVERSARIAL_GENERATED.referenceSolution,
      testSource: ADVERSARIAL_GENERATED.testSource,
    })
    expect(sandboxCalls[1]).toMatchObject({
      language: 'rust',
      code: ADVERSARIAL_GENERATED.starterCode,
      testSource: ADVERSARIAL_GENERATED.testSource,
    })

    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row).toMatchObject({
      mode: 'debug',
      status: 'verified',
      referenceSolution: ADVERSARIAL_GENERATED.referenceSolution,
      testSource: ADVERSARIAL_GENERATED.testSource,
    })
    // ADR-0023: the declared defect is persisted from the generation
    // contract so the verified-fallback path can surface it later.
    expect(row?.defect).toEqual(ADVERSARIAL_GENERATED.defect)

    const [attempt] = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempt?.attemptNumber).toBe(1)
    expect(attempt?.passed).toBe(true)
    expect(attempt?.diagnostics.checks).toHaveLength(3)
  })

  it('discards and retries a failing adversarial generation exactly like a non-adversarial one', async () => {
    generateExerciseMock.mockResolvedValue(ADVERSARIAL_GENERATED)
    // Attempt 1: the reference solution fails to compile.
    scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    // Attempt 2: the regenerated adversarial exercise passes every check.
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      adversarial: true,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.attemptNumber).toBe(2)

    // The retry was fed the attempt-1 diagnostics and kept the adversarial
    // target — the failed draft was discarded, never persisted.
    expect(generateExerciseMock).toHaveBeenCalledTimes(2)
    const retryInput = generateExerciseMock.mock.calls[1]?.[0]
    expect(retryInput?.previousDiagnostics?.checks[0]).toMatchObject({
      name: 'reference_passes',
      passed: false,
    })
    expect(retryInput?.adversarial).toBe(true)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts.map((attempt) => attempt.passed)).toEqual([false, true])

    const rows = await db
      .select()
      .from(exercises)
      .where(like(exercises.slug, 'rust-test-rust-borrowing-%'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mode: 'debug', status: 'verified' })
  })

  it('keeps the adversarial target through the simplified fallback regeneration', async () => {
    generateExerciseMock.mockResolvedValue(ADVERSARIAL_GENERATED)
    // Attempts 1-3: every run fails the same way.
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }
    // Attempt 4 (simplified constraint set): passes every check.
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      adversarial: true,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.simplified).toBe(true)
    expect(outcome.preflight.attemptNumber).toBe(4)
    expect(outcome.defect).toEqual(ADVERSARIAL_GENERATED.defect)

    const calls = generateExerciseMock.mock.calls.map(([call]) => call)
    expect(calls[3]?.simplifiedConstraints).toBe(true)
    expect(calls[3]?.adversarial).toBe(true)

    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row).toMatchObject({ mode: 'debug', status: 'verified' })
  })

  it('maps an AI Teacher Engine failure to a stable generation error without retrying', async () => {
    generateExerciseMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'engine unreachable'),
    )

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_GENERATION_FAILED' })

    expect(generateExerciseMock).toHaveBeenCalledTimes(1)
    expect(runSandboxSubmissionMock).not.toHaveBeenCalled()
    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempts).toHaveLength(0)
  })

  it('rejects a draft that does not target the requested concept without retrying', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      targetConcepts: ['test.rust.other'],
    })

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_GENERATION_INVALID' })
    expect(generateExerciseMock).toHaveBeenCalledTimes(1)
    expect(runSandboxSubmissionMock).not.toHaveBeenCalled()
  })

  it('passes sprintScoped into the AI call and persists a 5-10 minute exercise (ticket #13)', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      estimatedMinutes: 7,
    })
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      sprintScoped: true,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.estimatedMinutes).toBe(7)

    const aiCall = generateExerciseMock.mock.calls[0]?.[0]
    expect(aiCall?.sprintScoped).toBe(true)
  })

  it('rejects a sprint-scoped draft whose estimate falls outside 5-10 minutes without retrying', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      estimatedMinutes: 15,
    })

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
        learnerId,
        sprintScoped: true,
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_GENERATION_INVALID' })
    expect(generateExerciseMock).toHaveBeenCalledTimes(1)
    expect(runSandboxSubmissionMock).not.toHaveBeenCalled()
  })

  it('does not enforce the 5-10 minute window on a non-sprint generation', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      estimatedMinutes: 15,
    })
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
  })

  it('rejects an unknown concept with a stable error', async () => {
    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: 'test.rust.does-not-exist',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_NOT_FOUND' })
  })

  it('rejects languages whose generation is not enabled yet', async () => {
    await expect(
      generateExerciseForConcept({
        language: 'go',
        conceptSlug: 'go.is-even',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_GENERATION_UNSUPPORTED' })
  })

  it('drops target concepts that do not exist in the graph', async () => {
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      targetConcepts: [FIXTURE_CONCEPT_SLUG, 'test.rust.unknown'],
    })
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.targetConcepts).toEqual([FIXTURE_CONCEPT_SLUG])
    const joins = await db
      .select()
      .from(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, outcome.exercise.id))
    expect(joins).toHaveLength(1)
    expect(joins[0]?.conceptId).toBe(FIXTURE_CONCEPT_ID)
  })

  it('caps retries at 3 and persists the simplified fallback regeneration on attempt 4', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    // Attempts 1-3: every run fails the same way.
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }
    // Attempt 4 (simplified constraint set): passes every check.
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.simplified).toBe(true)
    expect(outcome.preflight.attemptNumber).toBe(4)

    // Exactly 4 AI calls; every retry carries the previous diagnostics and
    // only the terminal attempt carries the simplified-constraints marker.
    expect(generateExerciseMock).toHaveBeenCalledTimes(4)
    const calls = generateExerciseMock.mock.calls.map(([call]) => call)
    expect(calls[0]?.previousDiagnostics).toBeUndefined()
    for (const call of calls.slice(1)) {
      expect(call.previousDiagnostics).toBeDefined()
    }
    expect(calls[0]?.simplifiedConstraints).toBe(false)
    expect(calls[1]?.simplifiedConstraints).toBe(false)
    expect(calls[2]?.simplifiedConstraints).toBe(false)
    expect(calls[3]?.simplifiedConstraints).toBe(true)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts).toHaveLength(4)
    expect(attempts.map((attempt) => attempt.attemptNumber)).toEqual([
      1, 2, 3, 4,
    ])
    expect(attempts.map((attempt) => attempt.passed)).toEqual([
      false,
      false,
      false,
      true,
    ])

    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row?.status).toBe('verified')
  })

  it('falls back to a previously verified exercise on the same concept after 3 failures', async () => {
    const [fallbackRow] = await db
      .insert(exercises)
      .values({
        slug: 'fallback-seeded-exercise',
        language: 'rust',
        title: 'Seeded verified',
        prompt: 'Do the thing.',
        starterCode: 'pub fn seeded() {}',
        testSource: FALLBACK_TEST_SOURCE,
        referenceSolution: FALLBACK_REFERENCE_SOLUTION,
        evaluationRubric: {
          required: ['Does the thing'],
          prohibited: [],
          advisory: [],
        },
        mode: 'implement',
        guidance: 'guided',
        difficulty: 1,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning()
    if (!fallbackRow) {
      throw new Error('expected the fallback fixture exercise')
    }
    await db.insert(exerciseConcepts).values({
      exerciseId: fallbackRow.id,
      conceptId: FIXTURE_CONCEPT_ID,
    })

    generateExerciseMock.mockResolvedValue(GENERATED)
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    // The stored verified exercise is served as-is: no 4th generation, no
    // new exercise row, no new Pre-Flight run (ADR-0019). The request
    // resolves to `guided`, and only a guided row may serve it (issue #14).
    expect(outcome.kind).toBe('verified-fallback')
    if (outcome.kind !== 'verified-fallback') {
      return
    }
    expect(outcome.exercise.id).toBe(fallbackRow.id)
    expect(outcome.exercise.title).toBe('Seeded verified')
    expect(outcome.exercise.guidance).toBe('guided')
    expect(outcome.targetConcepts).toEqual([FIXTURE_CONCEPT_SLUG])
    expect(outcome.constraints).toEqual(['std_only'])
    expect(generateExerciseMock).toHaveBeenCalledTimes(3)

    // ADR-0019 AC-3: the served verified exercise reuses its stored
    // `test_source` / `reference_solution` — the row that was served still
    // carries exactly the artifacts seeded into the bank, untouched.
    const [servedRow] = await db
      .select({
        testSource: exercises.testSource,
        referenceSolution: exercises.referenceSolution,
      })
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(servedRow?.testSource).toBe(FALLBACK_TEST_SOURCE)
    expect(servedRow?.referenceSolution).toBe(FALLBACK_REFERENCE_SOLUTION)
    // ...and they are the stored ones, not the last failed draft's
    // regenerated source (a regeneration would have produced different
    // artifacts entirely).
    expect(servedRow?.testSource).not.toBe(GENERATED.testSource)
    expect(servedRow?.referenceSolution).not.toBe(GENERATED.referenceSolution)

    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts).toHaveLength(3)
    expect(attempts.every((attempt) => !attempt.passed)).toBe(true)
    expect(
      await db.$count(
        exercises,
        like(exercises.slug, 'rust-test-rust-borrowing-%'),
      ),
    ).toBe(0)

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, fallbackRow.id))
    await db.delete(exercises).where(eq(exercises.id, fallbackRow.id))
  })

  it('never serves a verified exercise of the other guidance as fallback', async () => {
    const [fallbackRow] = await db
      .insert(exercises)
      .values({
        slug: 'fallback-seeded-independent',
        language: 'rust',
        title: 'Seeded independent',
        prompt: 'Do the thing.',
        starterCode: 'pub fn seeded() {}',
        testSource: FALLBACK_TEST_SOURCE,
        referenceSolution: FALLBACK_REFERENCE_SOLUTION,
        evaluationRubric: {
          required: ['Does the thing'],
          prohibited: [],
          advisory: [],
        },
        mode: 'implement',
        guidance: 'independent',
        difficulty: 1,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning()
    if (!fallbackRow) {
      throw new Error('expected the fallback fixture exercise')
    }
    await db.insert(exerciseConcepts).values({
      exerciseId: fallbackRow.id,
      conceptId: FIXTURE_CONCEPT_ID,
    })

    // A `guided` request (the standalone card's default) with only an
    // `independent` row in the bank: the fallback must NOT serve it — an
    // independent row carries no hints, which would break the guided slot's
    // contract (issue #14). The circuit breaker falls through to the
    // terminal simplified regeneration instead.
    generateExerciseMock.mockResolvedValue(GENERATED)
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }
    scheduleFailingPreFlight([REFERENCE_PASSES, BROKEN_FAILS_ON_CONCEPT])

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.simplified).toBe(true)
    expect(outcome.exercise.id).not.toBe(fallbackRow.id)
    expect(generateExerciseMock).toHaveBeenCalledTimes(4)

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, fallbackRow.id))
    await db.delete(exercises).where(eq(exercises.id, fallbackRow.id))
  })

  it('rejects generation for a concept whose prerequisites are not Practiced (AC 4)', async () => {
    await db.insert(conceptEdges).values({
      fromConceptId: FIXTURE_ROOT_ID,
      toConceptId: FIXTURE_CONCEPT_ID,
      kind: 'prerequisite',
    })

    generateExerciseMock.mockResolvedValue(GENERATED)

    // No mastery rows exist: the fixture concept is gated by its unused
    // prerequisite, so generation must be rejected before any AI call —
    // the same server-side gate the curriculum surfaces run.
    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'PREREQUISITES_NOT_PRACTICED' })
    expect(generateExerciseMock).not.toHaveBeenCalled()
    expect(runSandboxSubmissionMock).not.toHaveBeenCalled()
  })

  it('allows generation once the concept prerequisites are Practiced (AC 4)', async () => {
    await db.insert(conceptEdges).values({
      fromConceptId: FIXTURE_ROOT_ID,
      toConceptId: FIXTURE_CONCEPT_ID,
      kind: 'prerequisite',
    })
    await advanceMastery(learnerId, [FIXTURE_ROOT_ID], 'practiced')

    generateExerciseMock.mockResolvedValue(GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    expect(generateExerciseMock).toHaveBeenCalledTimes(1)
  })

  it('exempts a sprintScoped generation from the no-skip-ahead gate (Class B, issue #14 Round 3)', async () => {
    await db.insert(conceptEdges).values({
      fromConceptId: FIXTURE_ROOT_ID,
      toConceptId: FIXTURE_CONCEPT_ID,
      kind: 'prerequisite',
    })

    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      estimatedMinutes: 7,
    })
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    // No mastery row exists for the prerequisite — this would reject with
    // PREREQUISITES_NOT_PRACTICED for a non-sprint request (the test right
    // above this one, and the "rejects generation..." test). Tactical
    // Sprint is exempt by design (SPEC story 8): a sprint reaches concepts
    // out of curriculum order on purpose.
    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      sprintScoped: true,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    const [row] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(row?.sprintScoped).toBe(true)
  })

  it('never serves a verified exercise of the other sprintScoped origin as fallback (issue #14 Round 3)', async () => {
    const [fallbackRow] = await db
      .insert(exercises)
      .values({
        slug: 'fallback-seeded-non-sprint',
        language: 'rust',
        title: 'Seeded non-sprint',
        prompt: 'Do the thing.',
        starterCode: 'pub fn seeded() {}',
        testSource: FALLBACK_TEST_SOURCE,
        referenceSolution: FALLBACK_REFERENCE_SOLUTION,
        evaluationRubric: {
          required: ['Does the thing'],
          prohibited: [],
          advisory: [],
        },
        mode: 'implement',
        guidance: 'guided',
        sprintScoped: false,
        difficulty: 1,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning()
    if (!fallbackRow) {
      throw new Error('expected the fallback fixture exercise')
    }
    await db.insert(exerciseConcepts).values({
      exerciseId: fallbackRow.id,
      conceptId: FIXTURE_CONCEPT_ID,
    })

    // A sprintScoped request with only a non-sprint row in the bank: the
    // fallback must NOT serve it — serving it would carry the row's
    // non-exempt `sprintScoped: false`, which would then block the
    // exercise's own submission even though it was reached through a
    // sprint. Falls through to the terminal simplified regeneration
    // instead, exactly like the guidance boundary (issue #14 Round 2).
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      estimatedMinutes: 7,
    })
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }
    scheduleFailingPreFlight([REFERENCE_PASSES, BROKEN_FAILS_ON_CONCEPT])

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
      sprintScoped: true,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.simplified).toBe(true)
    expect(outcome.exercise.id).not.toBe(fallbackRow.id)
    expect(generateExerciseMock).toHaveBeenCalledTimes(4)

    const [persisted] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(persisted?.sprintScoped).toBe(true)

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, fallbackRow.id))
    await db.delete(exercises).where(eq(exercises.id, fallbackRow.id))
  })

  it('never serves a sprintScoped banked row to a non-sprint fallback request (issue #134)', async () => {
    await db.insert(conceptEdges).values({
      fromConceptId: FIXTURE_ROOT_ID,
      toConceptId: FIXTURE_CONCEPT_ID,
      kind: 'prerequisite',
    })
    await advanceMastery(learnerId, [FIXTURE_ROOT_ID], 'practiced')

    const [fallbackRow] = await db
      .insert(exercises)
      .values({
        slug: 'fallback-seeded-sprint-scoped',
        language: 'rust',
        title: 'Seeded sprint-scoped',
        prompt: 'Do the thing.',
        starterCode: 'pub fn seeded() {}',
        testSource: FALLBACK_TEST_SOURCE,
        referenceSolution: FALLBACK_REFERENCE_SOLUTION,
        evaluationRubric: {
          required: ['Does the thing'],
          prohibited: [],
          advisory: [],
        },
        mode: 'implement',
        guidance: 'guided',
        sprintScoped: true,
        difficulty: 1,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning()
    if (!fallbackRow) {
      throw new Error('expected the fallback fixture exercise')
    }
    await db.insert(exerciseConcepts).values({
      exerciseId: fallbackRow.id,
      conceptId: FIXTURE_CONCEPT_ID,
    })

    // A non-sprint request with only a sprint-scoped row in the bank: the
    // fallback must NOT serve it — serving it would hand a gate-exempt row
    // to a request the no-skip-ahead gate (AC 4) runs for, reopening the
    // exemption as a bypass (the mirror of the issue #14 Round 3 test
    // above). Falls through to the terminal simplified regeneration.
    generateExerciseMock.mockResolvedValue({
      ...GENERATED,
      estimatedMinutes: 7,
    })
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }
    scheduleFailingPreFlight([REFERENCE_PASSES, BROKEN_FAILS_ON_CONCEPT])

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.simplified).toBe(true)
    expect(outcome.exercise.id).not.toBe(fallbackRow.id)
    expect(generateExerciseMock).toHaveBeenCalledTimes(4)

    const [persisted] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, outcome.exercise.id))
    expect(persisted?.sprintScoped).toBe(false)

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, fallbackRow.id))
    await db.delete(exercises).where(eq(exercises.id, fallbackRow.id))
  })

  it('surfaces the persisted defect when the verified fallback serves an adversarial row', async () => {
    const [fallbackRow] = await db
      .insert(exercises)
      .values({
        slug: 'fallback-seeded-adversarial',
        language: 'rust',
        title: 'Seeded adversarial',
        prompt: 'Find and fix the defect.',
        starterCode: 'pub fn seeded() {}',
        testSource: FALLBACK_TEST_SOURCE,
        referenceSolution: FALLBACK_REFERENCE_SOLUTION,
        evaluationRubric: {
          required: ['Fixes the defect'],
          prohibited: [],
          advisory: [],
        },
        mode: 'debug',
        defect: ADVERSARIAL_GENERATED.defect,
        difficulty: 1,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning()
    if (!fallbackRow) {
      throw new Error('expected the fallback fixture exercise')
    }
    await db.insert(exerciseConcepts).values({
      exerciseId: fallbackRow.id,
      conceptId: FIXTURE_CONCEPT_ID,
    })

    generateExerciseMock.mockResolvedValue(GENERATED)
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    // The stored adversarial row is served as-is, with its persisted defect
    // surfaced so the card labels it consistently (issue #120) — and only
    // the stored row's defect, never a regenerated draft's.
    expect(outcome.kind).toBe('verified-fallback')
    if (outcome.kind !== 'verified-fallback') {
      return
    }
    expect(outcome.exercise.id).toBe(fallbackRow.id)
    expect(outcome.defect).toEqual(ADVERSARIAL_GENERATED.defect)
    expect(generateExerciseMock).toHaveBeenCalledTimes(3)

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, fallbackRow.id))
    await db.delete(exercises).where(eq(exercises.id, fallbackRow.id))
  })

  it('serves a fallback row without a defect when the stored exercise is not adversarial', async () => {
    const [fallbackRow] = await db
      .insert(exercises)
      .values({
        slug: 'fallback-seeded-implement',
        language: 'rust',
        title: 'Seeded implement',
        prompt: 'Do the thing.',
        starterCode: 'pub fn seeded() {}',
        testSource: FALLBACK_TEST_SOURCE,
        referenceSolution: FALLBACK_REFERENCE_SOLUTION,
        evaluationRubric: {
          required: ['Does the thing'],
          prohibited: [],
          advisory: [],
        },
        mode: 'implement',
        difficulty: 1,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning()
    if (!fallbackRow) {
      throw new Error('expected the fallback fixture exercise')
    }
    await db.insert(exerciseConcepts).values({
      exerciseId: fallbackRow.id,
      conceptId: FIXTURE_CONCEPT_ID,
    })

    generateExerciseMock.mockResolvedValue(GENERATED)
    for (let attempt = 0; attempt < 3; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }

    const outcome = await generateExerciseForConcept({
      language: 'rust',
      conceptSlug: FIXTURE_CONCEPT_SLUG,
      learnerId,
    })

    expect(outcome.kind).toBe('verified-fallback')
    if (outcome.kind !== 'verified-fallback') {
      return
    }
    expect(outcome.exercise.id).toBe(fallbackRow.id)
    expect(outcome.defect).toBeUndefined()

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, fallbackRow.id))
    await db.delete(exercises).where(eq(exercises.id, fallbackRow.id))
  })

  it('throws a stable error when the simplified fallback regeneration also fails', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    for (let attempt = 0; attempt < 4; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' })

    expect(generateExerciseMock).toHaveBeenCalledTimes(4)
    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
      .orderBy(sql`attempt_number asc`)
    expect(attempts).toHaveLength(4)
    expect(attempts.every((attempt) => !attempt.passed)).toBe(true)
    // A learner is never shown an exercise that failed Pre-Flight.
    expect(
      await db.$count(
        exercises,
        like(exercises.slug, 'rust-test-rust-borrowing-%'),
      ),
    ).toBe(0)
  })

  it('exposes only verified generated exercises as available', async () => {
    await db.insert(exercises).values([
      {
        slug: 'test-generated-verified',
        language: 'rust',
        title: 'Visible generated',
        prompt: 'Do the thing.',
        starterCode: 'pub fn placeholder() {}',
        testSource: '#[test]\nfn works() { assert!(true); }\n',
        difficulty: 1,
        status: 'verified',
      },
      {
        slug: 'test-generated-pending',
        language: 'rust',
        title: 'Hidden pending',
        prompt: 'Do the thing.',
        starterCode: 'pub fn placeholder() {}',
        testSource: '#[test]\nfn works() { assert!(true); }\n',
        difficulty: 1,
        status: 'pending',
      },
    ])
    const verifiedRow = await db.query.exercises.findFirst({
      where: eq(exercises.slug, 'test-generated-verified'),
    })
    const pendingRow = await db.query.exercises.findFirst({
      where: eq(exercises.slug, 'test-generated-pending'),
    })
    if (!verifiedRow || !pendingRow) {
      throw new Error('expected the fixture exercises')
    }
    await db.insert(exerciseConcepts).values([
      {
        exerciseId: verifiedRow.id,
        conceptId: FIXTURE_CONCEPT_ID,
      },
      {
        exerciseId: pendingRow.id,
        conceptId: FIXTURE_CONCEPT_ID,
      },
    ])

    const available = await getAvailableExercises()

    expect(
      available.some((exercise) => exercise.slug === 'test-generated-verified'),
    ).toBe(true)
    expect(
      available.some((exercise) => exercise.slug === 'test-generated-pending'),
    ).toBe(false)

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, FIXTURE_CONCEPT_ID))
    await db
      .delete(exercises)
      .where(eq(exercises.slug, 'test-generated-verified'))
    await db
      .delete(exercises)
      .where(eq(exercises.slug, 'test-generated-pending'))
  })
})
