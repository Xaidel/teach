import { desc, eq, sql } from 'drizzle-orm'
import {
  afterAll,
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
  generateHint: vi.fn(),
  reviewSubmission: vi.fn(),
}))

import { db } from '#/db/client.server'
import { exercises, results, submissionHints, submissions } from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateHint, reviewSubmission } from '#/lib/ai/functions.server'
import type { ReviewSubmissionOutput } from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import { getCurrentLearnerId } from '../learners/learners.server'
import {
  getHardcodedExercises,
  HARDCODED_EXERCISE_SLUGS,
  requestHint,
  rowToExercise,
  submitExercise,
} from './exercise.server'
import type { Exercise } from './exercise.schema'
import {
  ADVISORY_CRITERION,
  PROHIBITED_CRITERION,
  REQUIRED_CRITERION,
  STAGE2_RUBRIC,
} from './stage2-review.rubric'

const PASSING_REVIEW_OUTPUT: ReviewSubmissionOutput = {
  required: [
    {
      criterion: REQUIRED_CRITERION,
      verdict: 'satisfied',
      explanation: 'The body computes n % 2 == 0.',
    },
  ],
  prohibited: [
    {
      criterion: PROHIBITED_CRITERION,
      verdict: 'satisfied',
      explanation: 'No lookup table is present.',
    },
  ],
  advisory: [
    {
      criterion: ADVISORY_CRITERION,
      verdict: 'satisfied',
      explanation: 'The body is a single expression.',
    },
  ],
}

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
const generateHintMock = vi.mocked(generateHint)
const reviewSubmissionMock = vi.mocked(reviewSubmission)

/**
 * Rust fixture used by the submission/hint tests: the seeded hardcoded
 * exercises no longer include a Rust one (issue #8 replaced it with
 * generated exercises), so the tests that need a submittable Rust exercise
 * insert their own namespaced fixture row.
 */
const RUST_FIXTURE_SLUG = 'test-rust-fixture'

async function insertRustFixture(): Promise<void> {
  await db
    .insert(exercises)
    .values({
      slug: RUST_FIXTURE_SLUG,
      language: 'rust',
      title: 'Is it even? (fixture)',
      prompt: 'Implement is_even(n: u32) -> bool.',
      starterCode: 'pub fn is_even(n: u32) -> bool {\n    false\n}\n',
      testSource:
        '#[test]\nfn handles_zero() { assert!(exercise::is_even(0)); }\n',
      referenceSolution:
        'pub fn is_even(n: u32) -> bool {\n    n % 2 == 0\n}\n',
      difficulty: 1,
      status: 'verified',
    })
    .onConflictDoNothing()
}

/** Loads the rust fixture row as the shared Exercise shape. */
async function getRustFixture(): Promise<Exercise> {
  const row = await db.query.exercises.findFirst({
    where: eq(exercises.slug, RUST_FIXTURE_SLUG),
  })
  if (!row) throw new Error('expected the rust fixture exercise')
  return rowToExercise(row)
}

beforeAll(async () => {
  await insertRustFixture()
})

afterAll(async () => {
  // Remove any submissions the fixture exercise accumulated (some tests
  // clean up by "latest submission for the learner", which can target a
  // different exercise's row), then the exercise itself.
  const fixtureRows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.slug, RUST_FIXTURE_SLUG))
  for (const row of fixtureRows) {
    const fixtureSubmissionIds = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.exerciseId, row.id))
    for (const submission of fixtureSubmissionIds) {
      await db
        .delete(submissionHints)
        .where(eq(submissionHints.submissionId, submission.id))
      await db.delete(results).where(eq(results.submissionId, submission.id))
    }
    await db.delete(submissions).where(eq(submissions.exerciseId, row.id))
  }
  await db.delete(exercises).where(eq(exercises.slug, RUST_FIXTURE_SLUG))
})

beforeEach(() => {
  runSandboxSubmissionMock.mockReset()
  generateHintMock.mockReset()
  reviewSubmissionMock.mockReset()
  reviewSubmissionMock.mockResolvedValue(PASSING_REVIEW_OUTPUT)
})

/** Removes the latest persisted submission for a learner, its result, and hints. */
async function deleteLatestSubmission(learnerId: string): Promise<void> {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.learnerId, learnerId))
    .orderBy(desc(submissions.createdAt))
    .limit(1)

  if (!submission) {
    throw new Error('expected a persisted submission to clean up')
  }

  await db
    .delete(submissionHints)
    .where(eq(submissionHints.submissionId, submission.id))
  await db.delete(results).where(eq(results.submissionId, submission.id))
  await db.delete(submissions).where(eq(submissions.id, submission.id))
}

describe.skipIf(!dbUp)('exercise server operations against Postgres', () => {
  it('returns every seeded hardcoded exercise with its language', async () => {
    const exercises = await getHardcodedExercises()

    expect(exercises.length).toBeGreaterThanOrEqual(1)
    expect(exercises.map((exercise) => exercise.slug).sort()).toEqual(
      [...HARDCODED_EXERCISE_SLUGS].sort(),
    )
    expect(exercises.map((exercise) => exercise.language).sort()).toEqual([
      'go',
      'python',
    ])
  })

  it('persists a submission and its result attributed to the current learner', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(true)
    expect(outcome.hint).toBeNull()
    expect(generateHintMock).not.toHaveBeenCalled()
    const submitted = runSandboxSubmissionMock.mock.calls[0]?.[0]
    expect(submitted).toMatchObject({
      language: 'rust',
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
    })
    expect(submitted?.testSource).toBeTruthy()

    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.learnerId, learnerId))
      .orderBy(desc(submissions.createdAt))
      .limit(1)

    expect(submission).toBeDefined()
    if (!submission) throw new Error('expected a persisted submission')
    expect(submission.exerciseId).toBe(rustExercise.id)
    expect(submission.learnerId).toBe(learnerId)

    const [persistedResult] = await db
      .select()
      .from(results)
      .where(eq(results.submissionId, submission.id))
      .limit(1)

    expect(persistedResult).toBeDefined()
    if (!persistedResult) throw new Error('expected a persisted result')
    expect(persistedResult.passed).toBe(true)
    expect(persistedResult.tests).toHaveLength(1)

    await db.delete(results).where(eq(results.submissionId, submission.id))
    await db.delete(submissions).where(eq(submissions.id, submission.id))
  })

  it('dispatches the submission to the sandbox of the exercise language', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'test_zero', status: 'passed' }],
    })

    const exercises = await getHardcodedExercises()
    const goExercise = exercises.find((exercise) => exercise.language === 'go')
    if (!goExercise) throw new Error('expected the seeded go exercise')
    const learnerId = await getCurrentLearnerId()

    await submitExercise({
      exerciseId: goExercise.id,
      code: 'package exercise',
      learnerId,
    })

    expect(runSandboxSubmissionMock.mock.calls.at(-1)?.[0]).toMatchObject({
      language: 'go',
    })
    expect(
      runSandboxSubmissionMock.mock.calls.at(-1)?.[0]?.testSource,
    ).toBeTruthy()
  })

  it('rejects a malformed sandbox result with a stable code before persisting it', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'not-a-status' }],
    } as unknown as Awaited<ReturnType<typeof runSandboxSubmission>>)

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()
    const submissionsBefore = await db.$count(submissions)

    await expect(
      submitExercise({
        exerciseId: rustExercise.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'SANDBOX_RESULT_INVALID' })

    expect(await db.$count(submissions)).toBe(submissionsBefore)
  })

  it('rejects a sandbox result with unknown keys (strict parsing) without persisting it', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
      surpriseField: 'unexpected',
    } as unknown as Awaited<ReturnType<typeof runSandboxSubmission>>)

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()
    const submissionsBefore = await db.$count(submissions)

    await expect(
      submitExercise({
        exerciseId: rustExercise.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'SANDBOX_RESULT_INVALID' })

    expect(await db.$count(submissions)).toBe(submissionsBefore)
  })

  it('throws a stable error for an unknown exercise', async () => {
    await expect(
      submitExercise({
        exerciseId: '00000000-0000-7000-8000-000000000000',
        code: 'fn main() {}',
        learnerId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_NOT_FOUND' })
  })

  it('generates a Level 0 hint with an empty prior-hints list on stage 1 failure', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [
        {
          name: 'returns_true_for_even_numbers',
          status: 'failed',
          message: 'assertion failed: exercise::is_even(4)',
        },
      ],
    })
    generateHintMock.mockResolvedValue({
      level: 0,
      content: 'What should is_even return when n is even?',
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(false)
    expect(outcome.hint).toEqual({
      level: 0,
      content: 'What should is_even return when n is even?',
    })

    const hintInput = generateHintMock.mock.calls.at(-1)?.[0]
    expect(hintInput).toMatchObject({
      language: 'rust',
      exerciseTitle: rustExercise.title,
      targetLevel: 0,
      priorHints: [],
    })
    expect(hintInput?.exercisePrompt).toBeTruthy()
    expect(hintInput?.referenceSolution).toContain('n % 2 == 0')

    const [servedHint] = await db
      .select()
      .from(submissionHints)
      .where(eq(submissionHints.submissionId, outcome.submissionId))
      .limit(1)

    expect(servedHint).toMatchObject({
      submissionId: outcome.submissionId,
      hintLevel: 0,
      content: 'What should is_even return when n is even?',
    })
    expect(servedHint?.servedAt).toBeInstanceOf(Date)

    await deleteLatestSubmission(learnerId)
  })

  it('falls back to the raw result when hint generation fails', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'hint service unavailable'),
    )

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(false)
    expect(outcome.hint).toBeNull()

    const served = await db
      .select()
      .from(submissionHints)
      .where(eq(submissionHints.submissionId, outcome.submissionId))
    expect(served).toHaveLength(0)

    await deleteLatestSubmission(learnerId)
  })

  it('persists the failed result message for later hint context', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
      message: 'compile error excerpt',
    })
    generateHintMock.mockResolvedValue({
      level: 0,
      content: 'A conceptual question.',
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    const [persisted] = await db
      .select()
      .from(results)
      .where(eq(results.submissionId, outcome.submissionId))
      .limit(1)
    expect(persisted?.message).toBe('compile error excerpt')

    await deleteLatestSubmission(learnerId)
  })

  it('escalates one level per request and records the full manual ladder', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockImplementation(({ targetLevel }) =>
      Promise.resolve({
        level: targetLevel,
        content: `Hint at level ${String(targetLevel)}`,
      }),
    )

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    for (const level of [1, 2, 3, 4]) {
      await expect(
        requestHint({
          submissionId: outcome.submissionId,
          action: 'next',
          learnerId,
        }),
      ).resolves.toEqual({
        hint: { level, content: `Hint at level ${String(level)}` },
      })
    }

    await expect(
      requestHint({
        submissionId: outcome.submissionId,
        action: 'next',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await expect(
      requestHint({
        submissionId: outcome.submissionId,
        action: 'full_solution',
        learnerId,
      }),
    ).resolves.toEqual({
      hint: { level: 5, content: 'Hint at level 5' },
    })

    expect(
      generateHintMock.mock.calls.map(([input]) => input.targetLevel),
    ).toEqual([0, 1, 2, 3, 4, 5])

    const served = await db
      .select({ hintLevel: submissionHints.hintLevel })
      .from(submissionHints)
      .where(eq(submissionHints.submissionId, outcome.submissionId))
      .orderBy(submissionHints.hintLevel)
    expect(served.map((row) => row.hintLevel)).toEqual([0, 1, 2, 3, 4, 5])

    await deleteLatestSubmission(learnerId)
  })

  it('passes the previously served hints into each escalation request', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockImplementation(({ targetLevel }) =>
      Promise.resolve({
        level: targetLevel,
        content: `Hint at level ${String(targetLevel)}`,
      }),
    )

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    await requestHint({
      submissionId: outcome.submissionId,
      action: 'next',
      learnerId,
    })
    await requestHint({
      submissionId: outcome.submissionId,
      action: 'next',
      learnerId,
    })

    const escalationCall = generateHintMock.mock.calls.at(-1)?.[0]
    expect(escalationCall).toMatchObject({
      targetLevel: 2,
      priorHints: [
        { level: 0, content: 'Hint at level 0' },
        { level: 1, content: 'Hint at level 1' },
      ],
    })
    expect(escalationCall?.referenceSolution).toContain('n % 2 == 0')

    await deleteLatestSubmission(learnerId)
  })

  it('requires the full-solution action before serving Level 5', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockImplementation(({ targetLevel }) =>
      Promise.resolve({
        level: targetLevel,
        content: `Hint at level ${String(targetLevel)}`,
      }),
    )

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    await expect(
      requestHint({
        submissionId: outcome.submissionId,
        action: 'full_solution',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await deleteLatestSubmission(learnerId)
  })

  it('rejects hint requests on a passed attempt', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
      learnerId,
    })

    await expect(
      requestHint({
        submissionId: outcome.submissionId,
        action: 'next',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await deleteLatestSubmission(learnerId)
  })

  it('rejects hint requests on another learner submission', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    await expect(
      requestHint({
        submissionId: outcome.submissionId,
        action: 'next',
        learnerId: '22222222-2222-7222-8222-222222222222',
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await deleteLatestSubmission(learnerId)
  })

  it('starts a fresh ladder for a new exercise attempt', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockImplementation(({ targetLevel }) =>
      Promise.resolve({
        level: targetLevel,
        content: `Hint at level ${String(targetLevel)}`,
      }),
    )

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const first = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })
    await requestHint({
      submissionId: first.submissionId,
      action: 'next',
      learnerId,
    })

    const second = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(second.submissionId).not.toBe(first.submissionId)

    const escalationCall = generateHintMock.mock.calls.at(-1)?.[0]
    expect(escalationCall).toMatchObject({ targetLevel: 0, priorHints: [] })

    await deleteLatestSubmission(learnerId)
  })

  it('does not persist an auto-served hint at an invalid engine level (issue #57)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockRejectedValue(
      new TeacherEngineError(
        'invalid_output',
        'engine returned hint level 5 for requested level 0',
      ),
    )

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(false)
    expect(outcome.hint).toBeNull()

    const served = await db
      .select()
      .from(submissionHints)
      .where(eq(submissionHints.submissionId, outcome.submissionId))
    expect(served).toHaveLength(0)

    await deleteLatestSubmission(learnerId)
  })

  it('fails gracefully when concurrent requests resolve the same hint level (issue #55)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockResolvedValue({
      level: 0,
      content: 'What should is_even return when n is even?',
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    let arrivals = 0
    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    generateHintMock.mockImplementation(({ targetLevel }) => {
      arrivals += 1
      return gate.then(() => ({
        level: targetLevel,
        content: `Hint at level ${String(targetLevel)}`,
      }))
    })

    const first = requestHint({
      submissionId: outcome.submissionId,
      action: 'next',
      learnerId,
    })
    const second = requestHint({
      submissionId: outcome.submissionId,
      action: 'next',
      learnerId,
    })

    await vi.waitFor(() => expect(arrivals).toBe(2))
    releaseGate()

    const settled = await Promise.allSettled([first, second])
    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled')
    const rejected = settled.filter((entry) => entry.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    if (rejected[0]?.status === 'rejected') {
      expect(rejected[0].reason).toMatchObject({
        code: 'HINT_ESCALATION_INVALID',
      })
    }

    const served = await db
      .select({ hintLevel: submissionHints.hintLevel })
      .from(submissionHints)
      .where(eq(submissionHints.submissionId, outcome.submissionId))
    expect(served.map((row) => row.hintLevel).sort()).toEqual([0, 1])

    await deleteLatestSubmission(learnerId)
  })

  it('skips hint generation when the exercise has no reference solution (issue #5, fail closed)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockResolvedValue({
      level: 0,
      content: 'This should never be called.',
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-no-reference-solution',
        language: 'rust',
        title: 'No reference solution',
        prompt: 'Implement a function.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'fn placeholder() {}',
        learnerId,
      })

      expect(outcome.result.passed).toBe(false)
      expect(outcome.hint).toBeNull()
      expect(generateHintMock).not.toHaveBeenCalled()

      const escalation = await requestHint({
        submissionId: outcome.submissionId,
        action: 'next',
        learnerId,
      }).catch((error: unknown) => error)

      expect(escalation).toMatchObject({ code: 'EXERCISE_NOT_HINTABLE' })

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('runs the Stage 2 review against the exercise rubric when Stage 1 passes (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-rubric',
        language: 'rust',
        title: 'Stage 2 exercise',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const code = 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }'
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code,
        learnerId,
      })

      expect(outcome.result.passed).toBe(true)
      expect(outcome.hint).toBeNull()
      expect(outcome.stage2Review).toMatchObject({
        passed: true,
        refactorRequest: null,
      })

      const reviewInput = reviewSubmissionMock.mock.calls[0]?.[0]
      expect(reviewInput).toMatchObject({
        language: 'rust',
        exerciseTitle: 'Stage 2 exercise',
        rubric: STAGE2_RUBRIC,
      })
      expect(reviewInput?.submissionCode).toContain('n % 2 == 0')

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('blocks progress with a refactor request on a required-criterion violation (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
    reviewSubmissionMock.mockResolvedValue({
      ...PASSING_REVIEW_OUTPUT,
      required: [
        {
          criterion: REQUIRED_CRITERION,
          verdict: 'violated',
          explanation: 'The body never uses the remainder operator.',
        },
      ],
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-required-violation',
        language: 'rust',
        title: 'Stage 2 exercise',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
        learnerId,
      })

      expect(outcome.result.passed).toBe(true)
      expect(outcome.stage2Review).toMatchObject({
        passed: false,
        refactorRequest:
          'Refactor the submission to address: "Uses the remainder operator (%) to determine parity" — The body never uses the remainder operator.',
      })
      expect(outcome.stage2Review?.criteria[0]).toMatchObject({
        kind: 'required',
        verdict: 'violated',
      })

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('blocks progress on a prohibited-criterion violation (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
    reviewSubmissionMock.mockResolvedValue({
      ...PASSING_REVIEW_OUTPUT,
      prohibited: [
        {
          criterion: PROHIBITED_CRITERION,
          verdict: 'violated',
          explanation: 'A hardcoded lookup table is returned.',
        },
      ],
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-prohibited-violation',
        language: 'rust',
        title: 'Stage 2 exercise',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      })

      expect(outcome.stage2Review).toMatchObject({
        passed: false,
        refactorRequest:
          'Refactor the submission to address: "Returns a hardcoded lookup table instead of computing parity" — A hardcoded lookup table is returned.',
      })

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('never blocks progress on advisory-only violations (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
    reviewSubmissionMock.mockResolvedValue({
      ...PASSING_REVIEW_OUTPUT,
      advisory: [
        {
          criterion: ADVISORY_CRITERION,
          verdict: 'violated',
          explanation: 'The body is longer than it needs to be.',
        },
      ],
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-advisory-only',
        language: 'rust',
        title: 'Stage 2 exercise',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      })

      expect(outcome.stage2Review).toMatchObject({
        passed: true,
        refactorRequest: null,
      })
      expect(outcome.stage2Review?.criteria[2]).toMatchObject({
        kind: 'advisory',
        verdict: 'violated',
      })

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('skips Stage 2 when the exercise has no rubric (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-no-rubric',
        language: 'rust',
        title: 'No rubric',
        prompt: 'Implement a function.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'fn placeholder() -> bool { true }',
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'fn placeholder() -> bool { true }',
        learnerId,
      })

      expect(outcome.result.passed).toBe(true)
      expect(outcome.stage2Review).toBeNull()
      expect(reviewSubmissionMock).not.toHaveBeenCalled()

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('never runs Stage 2 on a Stage 1 failure (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(false)
    expect(outcome.stage2Review).toBeNull()
    expect(reviewSubmissionMock).not.toHaveBeenCalled()

    await deleteLatestSubmission(learnerId)
  })

  it('fails open when the AI review is unavailable (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
    reviewSubmissionMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'review service unavailable'),
    )

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-review-down',
        language: 'rust',
        title: 'Stage 2 exercise',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      })

      expect(outcome.result.passed).toBe(true)
      expect(outcome.stage2Review).toBeNull()

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })

  it('fails open when the AI review output is invalid (issue #6)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
    reviewSubmissionMock.mockResolvedValue({
      ...PASSING_REVIEW_OUTPUT,
      required: [
        {
          criterion: 'Parity is determined with the remainder operator',
          verdict: 'satisfied',
          explanation: 'The body computes n % 2 == 0.',
        },
      ],
    })

    const [inserted] = await db
      .insert(exercises)
      .values({
        slug: 'test-stage2-invalid-output',
        language: 'rust',
        title: 'Stage 2 exercise',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })

    if (!inserted) throw new Error('expected the inserted exercise')

    try {
      const learnerId = await getCurrentLearnerId()
      const outcome = await submitExercise({
        exerciseId: inserted.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      })

      expect(outcome.result.passed).toBe(true)
      expect(outcome.stage2Review).toBeNull()

      await deleteLatestSubmission(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })
})
