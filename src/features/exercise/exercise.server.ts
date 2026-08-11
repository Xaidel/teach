import { eq, inArray } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { exercises, results, submissions } from '#/db/schema'
import { runSandboxSubmission, SandboxError } from '#/lib/sandbox/runner.server'
import { isSandboxLanguage } from '#/lib/sandbox/types'

import { ExerciseError, parseSandboxResult } from './exercise.schema'
import type { Exercise, SandboxResult } from './exercise.schema'

/** Slugs of the hardcoded v1 exercises, one per sandbox language (issue #2). */
export const HARDCODED_EXERCISE_SLUGS = [
  'rust-is-even',
  'go-is-even',
  'python-is-even',
] as const

/** Full exercise record available only on the server, including hidden tests. */
type ServerExercise = Exercise & { testSource: string }

type ExerciseRow = typeof exercises.$inferSelect

/** Maps a persisted exercise row to the shared exercise shape. */
function rowToExercise(row: ExerciseRow): Exercise {
  if (!isSandboxLanguage(row.language)) {
    throw new SandboxError(
      'SANDBOX_UNSUPPORTED_LANGUAGE',
      `The exercise "${row.slug}" uses language "${row.language}", which has no sandbox image configured.`,
    )
  }

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

/** Returns all seeded hardcoded exercises, or null before seeding. */
export async function getHardcodedExercises(): Promise<Exercise[]> {
  const rows = await db.query.exercises.findMany({
    where: inArray(exercises.slug, [...HARDCODED_EXERCISE_SLUGS]),
  })

  return rows.map(rowToExercise)
}

/**
 * Runs one submission through the sandbox of the exercise's language and
 * persists the submission and its normalized result. The caller resolves the
 * current learner once and passes the id down (ADR-0014).
 */
export async function submitExercise(input: {
  exerciseId: string
  code: string
  learnerId: string
}): Promise<SandboxResult> {
  const exercise = await getExerciseById(input.exerciseId)

  const sandboxResult = parseSandboxResult(
    await runSandboxSubmission({
      language: exercise.language,
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
