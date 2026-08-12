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

    expect(outcome.exercise.title).toBe('Borrow or move?')
    expect(outcome.exercise.language).toBe('rust')
    expect(outcome.targetConcepts).toEqual([FIXTURE_CONCEPT_SLUG])
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

  it('logs a failed attempt and persists no exercise when the reference solution fails', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce({
        passed: false,
        tests: [],
        message: 'reference solution does not compile',
      })
      .mockResolvedValueOnce(BROKEN_FAILS_ON_CONCEPT)

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
      }),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' })

    const [attempt] = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempt?.passed).toBe(false)
    expect(attempt?.diagnostics.checks[0]).toMatchObject({
      name: 'reference_passes',
      passed: false,
    })
    expect(
      await db.$count(
        exercises,
        like(exercises.slug, 'rust-test-rust-borrowing-%'),
      ),
    ).toBe(0)
  })

  it('rejects an exercise whose broken state does not fail', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce({
        passed: true,
        tests: [{ name: 'borrows_its_argument', status: 'passed' }],
      })

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
      }),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' })

    const [attempt] = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempt?.passed).toBe(false)
    expect(attempt?.diagnostics.checks[1]).toMatchObject({
      name: 'broken_state_fails',
      passed: false,
    })
  })

  it('rejects an exercise whose broken state fails only unrelated tests', async () => {
    generateExerciseMock.mockResolvedValue(GENERATED)
    runSandboxSubmissionMock
      .mockResolvedValueOnce(REFERENCE_PASSES)
      .mockResolvedValueOnce({
        passed: false,
        tests: [
          {
            name: 'an_unrelated_test',
            status: 'failed',
            message: 'assertion failed',
          },
        ],
      })

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
      }),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' })

    const [attempt] = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempt?.passed).toBe(false)
    expect(attempt?.diagnostics.checks[2]).toMatchObject({
      name: 'failure_matches_concept',
      passed: false,
    })
  })

  it('maps an AI Teacher Engine failure to a stable generation error', async () => {
    generateExerciseMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'engine unreachable'),
    )

    await expect(
      generateExerciseForConcept({
        language: 'rust',
        conceptSlug: FIXTURE_CONCEPT_SLUG,
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_GENERATION_FAILED' })

    expect(runSandboxSubmissionMock).not.toHaveBeenCalled()
    const attempts = await db
      .select()
      .from(preFlightAttempts)
      .where(eq(preFlightAttempts.conceptId, FIXTURE_CONCEPT_ID))
    expect(attempts).toHaveLength(0)
  })

  it('rejects a draft that does not target the requested concept', async () => {
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

    expect(outcome.targetConcepts).toEqual([FIXTURE_CONCEPT_SLUG])
    const joins = await db
      .select()
      .from(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, outcome.exercise.id))
    expect(joins).toHaveLength(1)
    expect(joins[0]?.conceptId).toBe(FIXTURE_CONCEPT_ID)
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
