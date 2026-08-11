import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { exercises, results, submissions } from '#/db/schema'
import { runRustSubmission } from '#/lib/sandbox/runner.server'

import { ExerciseError, parseSandboxResult } from './exercise.schema'
import type { Exercise, SandboxResult } from './exercise.schema'

/** Slug of the single v1 walking-skeleton exercise. */
export const HARDCODED_EXERCISE_SLUG = 'rust-is-even'

/** Full exercise record available only on the server, including hidden tests. */
type ServerExercise = Exercise & { testSource: string }

type ExerciseRow = typeof exercises.$inferSelect

/** Maps a persisted exercise row to the shared exercise shape. */
function rowToExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    slug: row.slug,
    language: row.language,
    title: row.title,
    prompt: row.prompt,
    starterCode: row.starterCode,
  }
}

async function getExerciseById(exerciseId: string): Promise<ServerExercise> {
  const row = await db.query.exercises.findFirst({
    where: eq(exercises.id, exerciseId),
  })

  if (!row) {
    throw new ExerciseError('EXERCISE_NOT_FOUND')
  }

  if (row.testSource === null) {
    throw new ExerciseError('EXERCISE_NOT_SUBMITTABLE')
  }

  return { ...rowToExercise(row), testSource: row.testSource }
}

/** Returns the single hardcoded v1 exercise, or null before seeding. */
export async function getHardcodedExercise(): Promise<Exercise | null> {
  const row = await db.query.exercises.findFirst({
    where: eq(exercises.slug, HARDCODED_EXERCISE_SLUG),
  })

  return row ? rowToExercise(row) : null
}

/**
 * Runs one submission through the Rust sandbox and persists the submission
 * and its normalized result. The caller resolves the current learner once and
 * passes the id down (ADR-0014).
 */
export async function submitExercise(input: {
  exerciseId: string
  code: string
  learnerId: string
}): Promise<SandboxResult> {
  const exercise = await getExerciseById(input.exerciseId)

  const sandboxResult = parseSandboxResult(
    await runRustSubmission({
      code: input.code,
      testSource: exercise.testSource,
    }),
  )

  const [submission] = await db
    .insert(submissions)
    .values({
      learnerId: input.learnerId,
      exerciseId: exercise.id,
      code: input.code,
    })
    .returning()

  if (!submission) {
    throw new Error('The submission insert returned no row.')
  }

  await db.insert(results).values({
    submissionId: submission.id,
    passed: sandboxResult.passed,
    tests: sandboxResult.tests,
  })

  return sandboxResult
}
