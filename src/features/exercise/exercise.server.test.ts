import { and, desc, eq, sql } from 'drizzle-orm'
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
  generateHint: vi.fn(),
  reviewSubmission: vi.fn(),
}))

import { db } from '#/db/client.server'
import {
  concepts,
  exerciseConcepts,
  exercises,
  attemptHints,
  attempts,
  learnerConceptMastery,
  learners,
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateHint, reviewSubmission } from '#/lib/ai/functions.server'
import type { ReviewSubmissionOutput } from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import { getCurrentLearnerId } from '../learners/learners.server'
import { getMasteryStates } from '../learners/mastery.server'
import {
  getAvailableExercises,
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
 * Rust fixture used by the attempt/hint tests: the seeded hardcoded
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
  // Remove any attempts the fixture exercise accumulated (some tests
  // clean up by "latest attempt for the learner", which can target a
  // different exercise's row), then the exercise itself.
  const fixtureRows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.slug, RUST_FIXTURE_SLUG))
  for (const row of fixtureRows) {
    const fixtureAttemptIds = await db
      .select({ id: attempts.id })
      .from(attempts)
      .where(eq(attempts.exerciseId, row.id))
    for (const attempt of fixtureAttemptIds) {
      await db
        .delete(attemptHints)
        .where(eq(attemptHints.attemptId, attempt.id))
    }
    await db.delete(attempts).where(eq(attempts.exerciseId, row.id))
  }
  await db.delete(exercises).where(eq(exercises.slug, RUST_FIXTURE_SLUG))
})

beforeEach(() => {
  runSandboxSubmissionMock.mockReset()
  generateHintMock.mockReset()
  reviewSubmissionMock.mockReset()
  reviewSubmissionMock.mockResolvedValue(PASSING_REVIEW_OUTPUT)
})

/** Removes the latest persisted attempt for a learner, and its hints. */
async function deleteLatestAttempt(learnerId: string): Promise<void> {
  const [attempt] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.learnerId, learnerId))
    .orderBy(desc(attempts.createdAt))
    .limit(1)

  if (!attempt) {
    throw new Error('expected a persisted attempt to clean up')
  }

  await db.delete(attemptHints).where(eq(attemptHints.attemptId, attempt.id))
  await db.delete(attempts).where(eq(attempts.id, attempt.id))
}

/**
 * Sets the (single, v1) learner's explanation depth/reference frame for the
 * duration of `run`, then restores the prior values (issue #12) — the
 * `learners` table holds exactly one row shared across every DB-backed
 * test in this file, so a preference change must never leak between tests.
 */
async function withLearnerExplanationPreferences<T>(
  learnerId: string,
  preferences: { depth: number; referenceFrame: string | null },
  run: () => Promise<T>,
): Promise<T> {
  const [previous] = await db
    .select({
      depth: learners.explanationDepth,
      referenceFrame: learners.referenceFrame,
    })
    .from(learners)
    .where(eq(learners.id, learnerId))
    .limit(1)
  if (!previous) {
    throw new Error('expected the seeded v1 learner row')
  }

  await db
    .update(learners)
    .set({
      explanationDepth: preferences.depth,
      referenceFrame: preferences.referenceFrame,
    })
    .where(eq(learners.id, learnerId))

  try {
    return await run()
  } finally {
    await db
      .update(learners)
      .set({
        explanationDepth: previous.depth,
        referenceFrame: previous.referenceFrame,
      })
      .where(eq(learners.id, learnerId))
  }
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

  it('hides hardcoded exercises whose status is not verified (issue #90)', async () => {
    await db
      .update(exercises)
      .set({ status: 'pending' })
      .where(eq(exercises.slug, 'go-is-even'))

    try {
      const available = await getHardcodedExercises()

      expect(available.some((exercise) => exercise.slug === 'go-is-even')).toBe(
        false,
      )
      expect(
        available.some((exercise) => exercise.slug === 'python-is-even'),
      ).toBe(true)
    } finally {
      await db
        .update(exercises)
        .set({ status: 'verified' })
        .where(eq(exercises.slug, 'go-is-even'))
    }
  })

  it('hides explain-mode rows from the practice list (issue #16)', async () => {
    const [explainRow] = await db
      .insert(exercises)
      .values({
        slug: 'test-explain-mode-row',
        language: 'rust',
        title: 'Explain fixture',
        prompt: 'Explain this concept in your own words.',
        starterCode: '',
        mode: 'explain',
        difficulty: 1,
        status: 'verified',
      })
      .onConflictDoNothing()
      .returning()
    if (!explainRow) throw new Error('expected a persisted exercise')

    const [concept] = await db
      .insert(concepts)
      .values({
        language: 'rust',
        slug: 'test.explain-mode-row-concept',
        difficulty: 1,
      })
      .returning()
    if (!concept) throw new Error('expected a persisted concept')
    await db
      .insert(exerciseConcepts)
      .values({ exerciseId: explainRow.id, conceptId: concept.id })

    try {
      const available = await getAvailableExercises()

      expect(
        available.some((exercise) => exercise.slug === 'test-explain-mode-row'),
      ).toBe(false)
    } finally {
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, explainRow.id))
      await db
        .delete(exercises)
        .where(eq(exercises.slug, 'test-explain-mode-row'))
      await db.delete(concepts).where(eq(concepts.id, concept.id))
    }
  })

  it('persists an attempt with its outcome and compiler diagnostics, attributed to the current learner (ADR-0010)', async () => {
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

    // Scoped to this suite's own rust fixture exercise: other suites write
    // attempts for the seeded learner concurrently (issue #113/#115's
    // per-suite fixture isolation), so a learner-wide "latest" read is
    // inherently racy. The fixture exercise is written by this suite only.
    const [attempt] = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.learnerId, learnerId),
          eq(attempts.exerciseId, rustExercise.id),
        ),
      )
      .orderBy(desc(attempts.createdAt))
      .limit(1)

    expect(attempt).toBeDefined()
    if (!attempt) throw new Error('expected a persisted attempt')
    expect(attempt.exerciseId).toBe(rustExercise.id)
    expect(attempt.learnerId).toBe(learnerId)
    expect(attempt.id).toBe(outcome.attemptId)
    expect(attempt.outcome).toBe('pass')
    expect(attempt.timeToSolution).toBe(0)
    expect(attempt.compilerErrors?.tests).toHaveLength(1)

    await deleteLatestAttempt(learnerId)
  })

  it('dispatches the attempt to the sandbox of the exercise language', async () => {
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
    // Scoped to this suite's own rust fixture exercise: other suites write
    // attempts for the seeded learner concurrently, so a table-wide count
    // is inherently racy (issue #113/#115's per-suite fixture isolation).
    const attemptsBefore = await db.$count(
      attempts,
      and(
        eq(attempts.learnerId, learnerId),
        eq(attempts.exerciseId, rustExercise.id),
      ),
    )

    await expect(
      submitExercise({
        exerciseId: rustExercise.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'SANDBOX_RESULT_INVALID' })

    expect(
      await db.$count(
        attempts,
        and(
          eq(attempts.learnerId, learnerId),
          eq(attempts.exerciseId, rustExercise.id),
        ),
      ),
    ).toBe(attemptsBefore)
  })

  it('rejects a sandbox result with unknown keys (strict parsing) without persisting it', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
      surpriseField: 'unexpected',
    } as unknown as Awaited<ReturnType<typeof runSandboxSubmission>>)

    const rustExercise = await getRustFixture()
    const learnerId = await getCurrentLearnerId()
    // Scoped to this suite's own rust fixture exercise (see the malformed-
    // result test above for the race rationale).
    const attemptsBefore = await db.$count(
      attempts,
      and(
        eq(attempts.learnerId, learnerId),
        eq(attempts.exerciseId, rustExercise.id),
      ),
    )

    await expect(
      submitExercise({
        exerciseId: rustExercise.id,
        code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'SANDBOX_RESULT_INVALID' })

    expect(
      await db.$count(
        attempts,
        and(
          eq(attempts.learnerId, learnerId),
          eq(attempts.exerciseId, rustExercise.id),
        ),
      ),
    ).toBe(attemptsBefore)
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
      .from(attemptHints)
      .where(eq(attemptHints.attemptId, outcome.attemptId))
      .limit(1)

    expect(servedHint).toMatchObject({
      attemptId: outcome.attemptId,
      hintLevel: 0,
      content: 'What should is_even return when n is even?',
    })
    expect(servedHint?.servedAt).toBeInstanceOf(Date)

    await deleteLatestAttempt(learnerId)
  })

  it("threads the learner's explanation depth/reference frame into the auto-hint call (issue #12)", async () => {
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

    await withLearnerExplanationPreferences(
      learnerId,
      { depth: 5, referenceFrame: 'as a senior JavaScript developer' },
      async () => {
        const outcome = await submitExercise({
          exerciseId: rustExercise.id,
          code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
          learnerId,
        })

        const hintInput = generateHintMock.mock.calls.at(-1)?.[0]
        expect(hintInput).toMatchObject({
          depth: 5,
          referenceFrame: 'as a senior JavaScript developer',
          targetLevel: 0,
        })

        await deleteLatestAttempt(learnerId)
        return outcome
      },
    )
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
      .from(attemptHints)
      .where(eq(attemptHints.attemptId, outcome.attemptId))
    expect(served).toHaveLength(0)

    await deleteLatestAttempt(learnerId)
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
      .from(attempts)
      .where(eq(attempts.id, outcome.attemptId))
      .limit(1)
    expect(persisted?.compilerErrors?.message).toBe('compile error excerpt')
    expect(persisted?.outcome).toBe('fail')

    await deleteLatestAttempt(learnerId)
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
          attemptId: outcome.attemptId,
          action: 'next',
          learnerId,
        }),
      ).resolves.toEqual({
        hint: { level, content: `Hint at level ${String(level)}` },
      })
    }

    await expect(
      requestHint({
        attemptId: outcome.attemptId,
        action: 'next',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await expect(
      requestHint({
        attemptId: outcome.attemptId,
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
      .select({ hintLevel: attemptHints.hintLevel })
      .from(attemptHints)
      .where(eq(attemptHints.attemptId, outcome.attemptId))
      .orderBy(attemptHints.hintLevel)
    expect(served.map((row) => row.hintLevel)).toEqual([0, 1, 2, 3, 4, 5])

    await deleteLatestAttempt(learnerId)
  })

  it("threads the learner's explanation depth/reference frame into a manual hint request without changing the escalated level (issue #12, AC 3)", async () => {
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

    await withLearnerExplanationPreferences(
      learnerId,
      { depth: 1, referenceFrame: null },
      async () => {
        const result = await requestHint({
          attemptId: outcome.attemptId,
          action: 'next',
          learnerId,
        })

        expect(result.hint.level).toBe(1)

        const hintInput = generateHintMock.mock.calls.at(-1)?.[0]
        expect(hintInput).toMatchObject({ depth: 1, targetLevel: 1 })
        expect(hintInput?.referenceFrame).toBeUndefined()
      },
    )

    await deleteLatestAttempt(learnerId)
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
      attemptId: outcome.attemptId,
      action: 'next',
      learnerId,
    })
    await requestHint({
      attemptId: outcome.attemptId,
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

    await deleteLatestAttempt(learnerId)
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
        attemptId: outcome.attemptId,
        action: 'full_solution',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await deleteLatestAttempt(learnerId)
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
        attemptId: outcome.attemptId,
        action: 'next',
        learnerId,
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await deleteLatestAttempt(learnerId)
  })

  it('rejects hint requests on another learner attempt', async () => {
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
        attemptId: outcome.attemptId,
        action: 'next',
        learnerId: '22222222-2222-7222-8222-222222222222',
      }),
    ).rejects.toMatchObject({ code: 'HINT_ESCALATION_INVALID' })

    await deleteLatestAttempt(learnerId)
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
      attemptId: first.attemptId,
      action: 'next',
      learnerId,
    })

    const second = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(second.attemptId).not.toBe(first.attemptId)

    const escalationCall = generateHintMock.mock.calls.at(-1)?.[0]
    expect(escalationCall).toMatchObject({ targetLevel: 0, priorHints: [] })

    await deleteLatestAttempt(learnerId)
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
      .from(attemptHints)
      .where(eq(attemptHints.attemptId, outcome.attemptId))
    expect(served).toHaveLength(0)

    await deleteLatestAttempt(learnerId)
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
      attemptId: outcome.attemptId,
      action: 'next',
      learnerId,
    })
    const second = requestHint({
      attemptId: outcome.attemptId,
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
      .select({ hintLevel: attemptHints.hintLevel })
      .from(attemptHints)
      .where(eq(attemptHints.attemptId, outcome.attemptId))
    expect(served.map((row) => row.hintLevel).sort()).toEqual([0, 1])

    await deleteLatestAttempt(learnerId)
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
        attemptId: outcome.attemptId,
        action: 'next',
        learnerId,
      }).catch((error: unknown) => error)

      expect(escalation).toMatchObject({ code: 'EXERCISE_NOT_HINTABLE' })

      await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
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

    await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
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

      await deleteLatestAttempt(learnerId)
    } finally {
      await db.delete(exercises).where(eq(exercises.id, inserted.id))
    }
  })
})

/**
 * Learner Model mastery advancement wired into `submitExercise` (ADR-0010,
 * ticket #10 acceptance criteria): `mastery.server.ts` itself is unit-tested
 * in isolation (mastery.server.test.ts) — these assert the actual call
 * site inside `submitExercise` advances the exercise's Concept Graph
 * concepts correctly for both a failed and a fully-completed attempt.
 */
describe.skipIf(!dbUp)('submitExercise mastery advancement (ADR-0010)', () => {
  let learnerId: string
  let conceptId: string
  let exerciseId: string

  beforeAll(async () => {
    learnerId = await getCurrentLearnerId()

    const [concept] = await db
      .insert(concepts)
      .values({
        language: 'rust',
        slug: 'test.exercise-server-mastery-fixture',
        difficulty: 1,
      })
      .returning()
    if (!concept) throw new Error('expected a persisted concept')
    conceptId = concept.id

    const [exercise] = await db
      .insert(exercises)
      .values({
        slug: 'test-mastery-advancement',
        language: 'rust',
        title: 'Mastery advancement fixture',
        prompt: 'Implement is_even.',
        starterCode: 'fn placeholder() {}',
        testSource: '#[test]\nfn placeholder_works() { assert!(true); }\n',
        referenceSolution: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
        evaluationRubric: STAGE2_RUBRIC,
        difficulty: 1,
        status: 'verified',
      })
      .returning({ id: exercises.id })
    if (!exercise) throw new Error('expected a persisted exercise')
    exerciseId = exercise.id

    await db.insert(exerciseConcepts).values({ exerciseId, conceptId })
  })

  afterAll(async () => {
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, exerciseId))
    await db.delete(exercises).where(eq(exercises.id, exerciseId))
    await db.delete(concepts).where(eq(concepts.id, conceptId))
  })

  afterEach(async () => {
    // Scope to this suite's own fixture concept: the seeded learner is
    // shared with other DB suites (issue #115), and a learner-wide delete
    // would clobber their mastery rows under file-parallel execution.
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, conceptId),
        ),
      )
  })

  it("advances a failed attempt's concept to Introduced (attribution AC)", async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })

    await submitExercise({
      exerciseId,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'introduced',
    })

    await deleteLatestAttempt(learnerId)
  })

  it('does not advance to Practiced on Stage 1 pass with a Stage 2 rubric violation', async () => {
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

    const outcome = await submitExercise({
      exerciseId,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })
    expect(outcome.stage2Review?.passed).toBe(false)

    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'introduced',
    })

    await deleteLatestAttempt(learnerId)
  })

  it('advances to Practiced when Stage 1 and Stage 2 both pass (completion AC)', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
    reviewSubmissionMock.mockResolvedValue(PASSING_REVIEW_OUTPUT)

    const outcome = await submitExercise({
      exerciseId,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
      learnerId,
    })
    expect(outcome.stage2Review?.passed).toBe(true)

    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'practiced',
    })

    await deleteLatestAttempt(learnerId)
  })

  it('is a no-op for hardcoded exercises with no exercise_concepts row', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'test_zero', status: 'passed' }],
    })

    const hardcoded = await getHardcodedExercises()
    const goExercise = hardcoded.find((exercise) => exercise.language === 'go')
    if (!goExercise) throw new Error('expected the seeded go exercise')

    await submitExercise({
      exerciseId: goExercise.id,
      code: 'package exercise',
      learnerId,
    })

    // No exercise_concepts row for the hardcoded exercise means nothing to
    // advance — asserting on this fixture's own concept confirms the run
    // didn't touch unrelated Learner Model state either.
    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'unknown',
    })

    await deleteLatestAttempt(learnerId)
  })
})
