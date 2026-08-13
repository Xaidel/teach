import { eq, like, sql } from 'drizzle-orm'
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
  concepts,
  exerciseConcepts,
  exercises,
  preFlightAttempts,
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateExercise } from '#/lib/ai/functions.server'
import type { GeneratedExercise } from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import type { SandboxResult } from '#/lib/sandbox/types'

import { generateExerciseForConcept } from './exercise-generation.server'
import { getAvailableExercises } from './exercise.server'

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

const FIXTURE_CONCEPT_SLUG = 'test.rust.borrowing'
const FIXTURE_CONCEPT_ID = '33333333-3333-7333-8333-333333333333'

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
  await db.insert(concepts).values({
    id: FIXTURE_CONCEPT_ID,
    language: 'rust',
    slug: FIXTURE_CONCEPT_SLUG,
    difficulty: 2,
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
}

afterEach(async () => {
  await cleanupGeneratedRows()
})

afterAll(async () => {
  await db.delete(concepts).where(eq(concepts.slug, FIXTURE_CONCEPT_SLUG))
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
    })

    expect(outcome.kind).toBe('generated')
    if (outcome.kind !== 'generated') {
      return
    }
    expect(outcome.preflight.passed).toBe(true)
  })

  it('maps an AI Teacher Engine failure to a stable generation error without retrying', async () => {
    generateExerciseMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'engine unreachable'),
    )

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
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
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_GENERATION_INVALID' })
    expect(generateExerciseMock).toHaveBeenCalledTimes(1)
    expect(runSandboxSubmissionMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown concept with a stable error', async () => {
    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: 'test.rust.does-not-exist',
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_NOT_FOUND' })
  })

  it('rejects languages whose generation is not enabled yet', async () => {
    await expect(
      generateExerciseForConcept({
        language: 'go',
        conceptSlug: 'go.is-even',
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
    })

    // The stored verified exercise is served as-is: no 4th generation, no
    // new exercise row, no new Pre-Flight run (ADR-0019).
    expect(outcome.kind).toBe('verified-fallback')
    if (outcome.kind !== 'verified-fallback') {
      return
    }
    expect(outcome.exercise.id).toBe(fallbackRow.id)
    expect(outcome.exercise.title).toBe('Seeded verified')
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

  it('throws a stable error when the simplified fallback regeneration also fails', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    for (let attempt = 0; attempt < 4; attempt++) {
      scheduleFailingPreFlight([REFERENCE_FAILS, BROKEN_FAILS_ON_CONCEPT])
    }

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
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
