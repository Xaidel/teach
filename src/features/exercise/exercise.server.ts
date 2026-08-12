import { and, asc, eq, inArray } from 'drizzle-orm'

import { db } from '#/db/client.server'
import {
  exerciseConcepts,
  exercises,
  results,
  submissionHints,
  submissions,
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateHint, reviewSubmission } from '#/lib/ai/functions.server'
import type { EvaluationRubric, Hint } from '#/lib/ai/schemas'
import { runSandboxSubmission, SandboxError } from '#/lib/sandbox/runner.server'
import { isSandboxLanguage } from '#/lib/sandbox/types'

import { ExerciseError, parseSandboxResult } from './exercise.schema'
import type {
  Exercise,
  HintRequestAction,
  RequestHintOutput,
  SandboxResult,
  Stage2Review,
  SubmitExerciseOutput,
} from './exercise.schema'
import { resolveTargetLevel } from './hint-ladder'
import { buildStage2Review } from './stage2-review.server'

/**
 * Slugs of the hardcoded v1 exercises (issue #1). Rust is no longer
 * hardcoded — it is replaced by exercises generated through the AI Teacher
 * Engine and verified by Pre-Flight (issue #8, ADR-0010); Go and Python
 * stay hardcoded until tickets #19/#20.
 */
export const HARDCODED_EXERCISE_SLUGS = [
  'go-is-even',
  'python-is-even',
] as const

/** Full exercise record available only on the server, including hidden tests. */
type ServerExercise = Exercise & {
  testSource: string
  referenceSolution: string | null
  evaluationRubric: EvaluationRubric | null
}

type ExerciseRow = typeof exercises.$inferSelect

/** Maps a persisted exercise row to the shared exercise shape. */
export function rowToExercise(row: ExerciseRow): Exercise {
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

  // Only Pre-Flight-verified exercises are ever submittable (issue #8):
  // a `pending`/`failed`/`retired` row must not reach the sandbox.
  if (row.status !== 'verified') {
    throw new ExerciseError('EXERCISE_NOT_SUBMITTABLE')
  }

  if (row.testSource === null) {
    throw new ExerciseError('EXERCISE_NOT_SUBMITTABLE')
  }

  return {
    ...rowToExercise(row),
    testSource: row.testSource,
    referenceSolution: row.referenceSolution,
    evaluationRubric: row.evaluationRubric,
  }
}

/** The context a hint request needs: the exercise, its failed result, prior hints. */
type HintContext = {
  exercise: Exercise
  result: SandboxResult
  priorHints: { level: number; content: string }[]
  referenceSolution: string | null
}

/**
 * Loads the exercise, persisted result, and already-served hints for one
 * submission, scoped to the calling learner so one learner can never request
 * hints on another learner's attempt. Missing or foreign submissions surface
 * as a stable escalation error.
 */
async function getHintContext(input: {
  submissionId: string
  learnerId: string
}): Promise<HintContext> {
  const rows = await db
    .select({ exercise: exercises, result: results })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .innerJoin(results, eq(results.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.learnerId, input.learnerId),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new ExerciseError('HINT_ESCALATION_INVALID')
  }

  const priorHints = await db
    .select({
      level: submissionHints.hintLevel,
      content: submissionHints.content,
    })
    .from(submissionHints)
    .where(eq(submissionHints.submissionId, input.submissionId))
    .orderBy(asc(submissionHints.hintLevel))

  return {
    exercise: rowToExercise(row.exercise),
    result: {
      passed: row.result.passed,
      tests: row.result.tests,
      ...(row.result.message === null ? {} : { message: row.result.message }),
    },
    priorHints,
    referenceSolution: row.exercise.referenceSolution,
  }
}

/** Returns all seeded hardcoded exercises, or null before seeding. */
export async function getHardcodedExercises(): Promise<Exercise[]> {
  const rows = await db.query.exercises.findMany({
    where: inArray(exercises.slug, [...HARDCODED_EXERCISE_SLUGS]),
  })

  return rows.map(rowToExercise)
}

/**
 * Returns every exercise a learner may attempt: the hardcoded v1 seeds
 * plus every Pre-Flight-verified generated exercise (the exercises with an
 * `exercise_concepts` row — generated exercises are exactly those linked
 * to a Concept Graph concept, issue #8). Only `status = verified` rows are
 * ever shown (ADR-0010, acceptance criterion).
 */
export async function getAvailableExercises(): Promise<Exercise[]> {
  const [hardcoded, generatedIds] = await Promise.all([
    getHardcodedExercises(),
    db
      .selectDistinct({ exerciseId: exerciseConcepts.exerciseId })
      .from(exerciseConcepts)
      .innerJoin(exercises, eq(exercises.id, exerciseConcepts.exerciseId))
      .where(eq(exercises.status, 'verified')),
  ])

  if (generatedIds.length === 0) {
    return hardcoded
  }

  const generated = await db.query.exercises.findMany({
    where: inArray(
      exercises.id,
      generatedIds.map((row) => row.exerciseId),
    ),
    orderBy: asc(exercises.createdAt),
  })

  return [...hardcoded, ...generated.map(rowToExercise)]
}

/**
 * Runs one submission through the sandbox of the exercise's language and
 * persists the submission and its normalized result. The caller resolves the
 * current learner once and passes the id down (ADR-0014).
 *
 * On Stage 1 failure the AI Teacher Engine generates a Level 0 Socratic hint
 * (empty prior-hints list for a fresh attempt); the hint only accompanies the
 * result and never determines pass/fail (issue #3). If hint generation
 * itself fails, the deterministic verdict still reaches the learner — the
 * raw result is returned without a hint (issue #3, AC 5).
 *
 * On Stage 1 success with a rubric-bearing exercise, the submission is
 * reviewed against the rubric (Stage 2, issue #6) — see `runStage2Review`.
 */
export async function submitExercise(input: {
  exerciseId: string
  code: string
  learnerId: string
}): Promise<SubmitExerciseOutput> {
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
    message: sandboxResult.message ?? null,
  })

  if (sandboxResult.passed) {
    return {
      submissionId: submission.id,
      result: sandboxResult,
      hint: null,
      stage2Review: await runStage2Review(exercise, input.code),
    }
  }

  let hint: Hint | null = null
  // Best-effort auto-hint: silently skipped when the exercise has no
  // reference solution (unlike requestHint's explicit EXERCISE_NOT_HINTABLE),
  // because a failed submission must still be recorded and returned.
  if (exercise.referenceSolution !== null) {
    try {
      hint = await generateHint({
        language: exercise.language,
        exerciseTitle: exercise.title,
        exercisePrompt: exercise.prompt,
        sandboxResult,
        targetLevel: resolveTargetLevel([], 'next'),
        priorHints: [],
        referenceSolution: exercise.referenceSolution,
      })
    } catch (error) {
      if (!(error instanceof TeacherEngineError)) {
        throw error
      }
    }
  }

  if (hint) {
    await db.insert(submissionHints).values({
      submissionId: submission.id,
      hintLevel: hint.level,
      content: hint.content,
    })
  }

  return {
    submissionId: submission.id,
    result: sandboxResult,
    hint,
    stage2Review: null,
  }
}

/**
 * Runs the Stage 2 qualitative review of a Stage 1-passing submission
 * against the exercise's rubric (SPEC stories 19-21, issue #6). Returns
 * null when the exercise has no rubric (explain-mode rows, ADR-0017) or
 * when the AI review itself fails — the deterministic Stage 1 verdict
 * always reaches the learner, exactly like the hint path (issue #3, AC 5).
 * Pass/fail is derived app-side from the rubric's criterion kinds
 * (PRD §18), never by the model (SPEC story 28).
 */
async function runStage2Review(
  exercise: ServerExercise,
  code: string,
): Promise<Stage2Review | null> {
  if (exercise.evaluationRubric === null) {
    return null
  }

  try {
    const output = await reviewSubmission({
      language: exercise.language,
      exerciseTitle: exercise.title,
      exercisePrompt: exercise.prompt,
      rubric: exercise.evaluationRubric,
      submissionCode: code,
    })
    return buildStage2Review(exercise.evaluationRubric, output)
  } catch (error) {
    if (!(error instanceof TeacherEngineError)) {
      throw error
    }
    return null
  }
}

/**
 * Serves and records the next hint level for a persisted exercise attempt.
 * Progression is derived and validated server-side from the hints already
 * recorded against the attempt (issue #4): the next action climbs Levels
 * 0-4 one at a time, and the full-solution action serves Level 5, only after
 * Level 4 was served. Requests against a passed attempt, a level past the
 * ladder, or a foreign submission are rejected. Concurrent requests that
 * resolve the same level (two parallel reads of the same prior-hints list)
 * fail gracefully as `HINT_ESCALATION_INVALID` instead of surfacing a raw
 * unique-violation on the `submission_hints_level_unique` index (issue #55).
 */
export async function requestHint(input: {
  submissionId: string
  action: HintRequestAction
  learnerId: string
}): Promise<RequestHintOutput> {
  const context = await getHintContext(input)

  if (context.result.passed) {
    throw new ExerciseError('HINT_ESCALATION_INVALID')
  }

  const targetLevel = resolveTargetLevel(
    context.priorHints.map((priorHint) => priorHint.level),
    input.action,
  )

  if (context.referenceSolution === null) {
    throw new ExerciseError('EXERCISE_NOT_HINTABLE')
  }

  const hint = await generateHint({
    language: context.exercise.language,
    exerciseTitle: context.exercise.title,
    exercisePrompt: context.exercise.prompt,
    sandboxResult: context.result,
    targetLevel,
    priorHints: context.priorHints,
    referenceSolution: context.referenceSolution,
  })

  const inserted = await db
    .insert(submissionHints)
    .values({
      submissionId: input.submissionId,
      hintLevel: hint.level,
      content: hint.content,
    })
    .onConflictDoNothing({
      target: [submissionHints.submissionId, submissionHints.hintLevel],
    })
    .returning({ id: submissionHints.id })

  if (inserted.length === 0) {
    throw new ExerciseError('HINT_ESCALATION_INVALID')
  }

  return { hint }
}
