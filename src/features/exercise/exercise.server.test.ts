import { desc, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

import { db } from '#/db/client.server'
import { results, submissions } from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateHint } from '#/lib/ai/functions.server'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import { getCurrentLearnerId } from '../learners/learners.server'
import {
  getHardcodedExercises,
  HARDCODED_EXERCISE_SLUGS,
  submitExercise,
} from './exercise.server'

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

beforeEach(() => {
  generateHintMock.mockReset()
})

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
      'rust',
    ])
  })

  it('persists a submission and its result attributed to the current learner', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    const exercises = await getHardcodedExercises()
    const rustExercise = exercises.find(
      (exercise) => exercise.language === 'rust',
    )
    if (!rustExercise) throw new Error('expected the seeded rust exercise')
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

    const exercises = await getHardcodedExercises()
    const rustExercise = exercises.find(
      (exercise) => exercise.language === 'rust',
    )
    if (!rustExercise) throw new Error('expected the seeded rust exercise')
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

    const exercises = await getHardcodedExercises()
    const rustExercise = exercises.find(
      (exercise) => exercise.language === 'rust',
    )
    if (!rustExercise) throw new Error('expected the seeded rust exercise')
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
      text: 'What should is_even return when n is even?',
    })

    const exercises = await getHardcodedExercises()
    const rustExercise = exercises.find(
      (exercise) => exercise.language === 'rust',
    )
    if (!rustExercise) throw new Error('expected the seeded rust exercise')
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(false)
    expect(outcome.hint).toEqual({
      level: 0,
      text: 'What should is_even return when n is even?',
    })

    const hintInput = generateHintMock.mock.calls.at(-1)?.[0]
    expect(hintInput).toMatchObject({
      language: 'rust',
      exerciseTitle: rustExercise.title,
      targetLevel: 0,
      priorHints: [],
    })
    expect(hintInput?.exercisePrompt).toBeTruthy()

    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.learnerId, learnerId))
      .orderBy(desc(submissions.createdAt))
      .limit(1)
    if (!submission) throw new Error('expected a persisted submission')
    await db.delete(results).where(eq(results.submissionId, submission.id))
    await db.delete(submissions).where(eq(submissions.id, submission.id))
  })

  it('falls back to the raw result when hint generation fails', async () => {
    runSandboxSubmissionMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })
    generateHintMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'hint service unavailable'),
    )

    const exercises = await getHardcodedExercises()
    const rustExercise = exercises.find(
      (exercise) => exercise.language === 'rust',
    )
    if (!rustExercise) throw new Error('expected the seeded rust exercise')
    const learnerId = await getCurrentLearnerId()

    const outcome = await submitExercise({
      exerciseId: rustExercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 1 }',
      learnerId,
    })

    expect(outcome.result.passed).toBe(false)
    expect(outcome.hint).toBeNull()

    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.learnerId, learnerId))
      .orderBy(desc(submissions.createdAt))
      .limit(1)
    if (!submission) throw new Error('expected a persisted submission')
    await db.delete(results).where(eq(results.submissionId, submission.id))
    await db.delete(submissions).where(eq(submissions.id, submission.id))
  })
})
