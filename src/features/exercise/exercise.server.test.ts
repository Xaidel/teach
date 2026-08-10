import { desc, eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/sandbox/runner.server', () => ({
  runRustSubmission: vi.fn(),
}))

import { db } from '#/db/client.server'
import { results, submissions } from '#/db/schema'
import { runRustSubmission } from '#/lib/sandbox/runner.server'
import { getCurrentLearnerId } from '../learners/learners.server'
import {
  getHardcodedExercise,
  HARDCODED_EXERCISE_SLUG,
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
const runRustSubmissionMock = vi.mocked(runRustSubmission)

describe.skipIf(!dbUp)('exercise server operations against Postgres', () => {
  it('returns the seeded hardcoded exercise', async () => {
    const exercise = await getHardcodedExercise()

    expect(exercise).not.toBeNull()
    if (!exercise) throw new Error('expected the seeded exercise')
    expect(exercise.slug).toBe(HARDCODED_EXERCISE_SLUG)
    expect(exercise.language).toBe('rust')
  })

  it('persists a submission and its result attributed to the current learner', async () => {
    runRustSubmissionMock.mockResolvedValue({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    const exercise = await getHardcodedExercise()
    if (!exercise) throw new Error('expected the seeded exercise')
    const learnerId = await getCurrentLearnerId()

    const result = await submitExercise({
      exerciseId: exercise.id,
      code: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
      learnerId,
    })

    expect(result.passed).toBe(true)
    const submitted = runRustSubmissionMock.mock.calls[0]?.[0]
    expect(submitted?.code).toBe(
      'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
    )
    expect(submitted?.testSource).toBeTruthy()

    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.learnerId, learnerId))
      .orderBy(desc(submissions.createdAt))
      .limit(1)

    expect(submission).toBeDefined()
    if (!submission) throw new Error('expected a persisted submission')
    expect(submission.exerciseId).toBe(exercise.id)
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

  it('throws a stable error for an unknown exercise', async () => {
    await expect(
      submitExercise({
        exerciseId: '00000000-0000-7000-8000-000000000000',
        code: 'fn main() {}',
        learnerId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ code: 'EXERCISE_NOT_FOUND' })
  })
})
