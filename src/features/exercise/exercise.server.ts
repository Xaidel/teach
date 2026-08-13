import { and, asc, eq, inArray, ne } from 'drizzle-orm'

import { db } from '#/db/client.server'
import {
  attemptHints,
  attempts,
  exerciseConcepts,
  exercises,
} from '#/db/schema'
// Deliberate, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): completing an exercise is the one place
// attempt outcomes drive Learner Model mastery, so `exercise` depends one-way
// on the single named entry point `learners/mastery.server.ts` exposes for
// this. `learners` owns the mastery-transition decision entirely — `exercise`
// only reports the two outcome booleans; `learners` never imports back from
// `exercise`, so the graph stays acyclic.
import { recordAttemptOutcome } from '#/features/learners/mastery.server'
// Same exception: `getExerciseConceptIds` resolves an exercise's Concept
// Graph concepts for the no-skip-ahead gate (issue #14, AC 4) — the same
// lookup the mastery transition itself uses.
import { getExerciseConceptIds } from '#/features/learners/mastery.server'
// Same exception: the no-skip-ahead gate (issue #14, AC 4) is owned by the
// Concept Graph, so submission depends one-way on the single named entry
// point `concepts/concepts.server.ts` exposes for it. `concepts` never
// imports back from `exercise`, so the graph stays acyclic.
import { assertPrerequisitesPracticed } from '#/features/concepts/concepts.server'
// Same exception: serving a hint is the one place a learner's explanation
// preferences (issue #12) shape an AI Teacher Engine call, so `exercise`
// depends one-way on the single named entry point `learners/learners.server.ts`
// exposes for this. `learners` never imports back from `exercise`.
import { getExplanationPreferences } from '#/features/learners/learners.server'
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
  /**
   * Whether this row was generated through Tactical Sprint (Class B, issue
   * #14 Round 3) — exempts submission from the no-skip-ahead gate, the same
   * exemption `generateExerciseForConcept` already applied at generation.
   * Server-only: never exposed on the client-facing `Exercise` shape.
   */
  sprintScoped: boolean
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
    guidance: row.guidance,
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
    sprintScoped: row.sprintScoped,
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
 * Loads the exercise, persisted attempt, and already-served hints for one
 * attempt, scoped to the calling learner so one learner can never request
 * hints on another learner's attempt. Missing or foreign attempts surface
 * as a stable escalation error.
 */
async function getHintContext(input: {
  attemptId: string
  learnerId: string
}): Promise<HintContext> {
  const rows = await db
    .select({ exercise: exercises, attempt: attempts })
    .from(attempts)
    .innerJoin(exercises, eq(exercises.id, attempts.exerciseId))
    .where(
      and(
        eq(attempts.id, input.attemptId),
        eq(attempts.learnerId, input.learnerId),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new ExerciseError('HINT_ESCALATION_INVALID')
  }

  // An independent exercise (issue #14's Class A curriculum step) is solved
  // without any Socratic scaffolding: no hint level may ever be served for
  // it, whatever the request claims.
  if (row.exercise.guidance === 'independent') {
    throw new ExerciseError('EXERCISE_HINTS_DISABLED')
  }

  const priorHints = await db
    .select({
      level: attemptHints.hintLevel,
      content: attemptHints.content,
    })
    .from(attemptHints)
    .where(eq(attemptHints.attemptId, input.attemptId))
    .orderBy(asc(attemptHints.hintLevel))

  const message = row.attempt.compilerErrors?.message ?? null

  return {
    exercise: rowToExercise(row.exercise),
    result: {
      passed: row.attempt.outcome === 'pass',
      tests: row.attempt.compilerErrors?.tests ?? [],
      ...(message === null ? {} : { message }),
    },
    priorHints,
    referenceSolution: row.exercise.referenceSolution,
  }
}

/**
 * Returns all seeded hardcoded exercises, or null before seeding. Like the
 * generated path, only `status = verified` rows are ever surfaced — a
 * retired seed row must not list (issue #90).
 */
export async function getHardcodedExercises(): Promise<Exercise[]> {
  const rows = await db.query.exercises.findMany({
    where: and(
      inArray(exercises.slug, [...HARDCODED_EXERCISE_SLUGS]),
      eq(exercises.status, 'verified'),
    ),
  })

  return rows.map(rowToExercise)
}

/**
 * Returns every exercise a learner may attempt: the hardcoded v1 seeds
 * plus every Pre-Flight-verified generated exercise (the exercises with an
 * `exercise_concepts` row — generated exercises are exactly those linked
 * to a Concept Graph concept, issue #8). Only `status = verified` rows are
 * ever shown (ADR-0010, acceptance criterion), and `explain`-mode rows are
 * excluded: they are the Explanation Assessment's record rows (ADR-0010,
 * issue #16), assessed through their own flow, not submittable practice.
 */
export async function getAvailableExercises(): Promise<Exercise[]> {
  const [hardcoded, generatedIds] = await Promise.all([
    getHardcodedExercises(),
    db
      .selectDistinct({ exerciseId: exerciseConcepts.exerciseId })
      .from(exerciseConcepts)
      .innerJoin(exercises, eq(exercises.id, exerciseConcepts.exerciseId))
      .where(
        and(eq(exercises.status, 'verified'), ne(exercises.mode, 'explain')),
      ),
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
 * Seconds elapsed since the learner's earliest attempt at this exercise —
 * 0 on that first attempt (ADR-0010's `time_to_solution`, SPEC story 42).
 * A plain read-then-write, not a single atomic query: v1 has one learner
 * and no concurrent submissions on the same exercise to race against
 * (ADR-0014's solo-maintainer-operability driver).
 */
async function computeTimeToSolutionSeconds(
  learnerId: string,
  exerciseId: string,
): Promise<number> {
  const [earliest] = await db
    .select({ createdAt: attempts.createdAt })
    .from(attempts)
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        eq(attempts.exerciseId, exerciseId),
      ),
    )
    .orderBy(asc(attempts.createdAt))
    .limit(1)

  if (!earliest) return 0
  return Math.max(
    0,
    Math.round((Date.now() - earliest.createdAt.getTime()) / 1000),
  )
}

/**
 * Runs one attempt through the sandbox of the exercise's language and
 * persists it (ADR-0010: merges the walking skeleton's `submissions` +
 * `results` into `attempts`). The caller resolves the current learner once
 * and passes the id down (ADR-0014).
 *
 * On Stage 1 failure the AI Teacher Engine generates a Level 0 Socratic hint
 * (empty prior-hints list for a fresh attempt); the hint only accompanies the
 * result and never determines pass/fail (issue #3). The hint is phrased at
 * the learner's current explanation depth/reference frame (issue #12),
 * which never influences the requested Level 0 itself. If hint generation
 * itself fails, the deterministic verdict still reaches the learner — the
 * raw result is returned without a hint (issue #3, AC 5).
 *
 * On Stage 1 success with a rubric-bearing exercise, the submission is
 * reviewed against the rubric (Stage 2, issue #6) — see `runStage2Review`.
 * Either way, the attempt's outcome is reported to the Learner Model
 * (`recordAttemptOutcome`) before the result reaches the caller.
 */
export async function submitExercise(input: {
  exerciseId: string
  code: string
  learnerId: string
}): Promise<SubmitExerciseOutput> {
  const exercise = await getExerciseById(input.exerciseId)

  // The no-skip-ahead gate (issue #14, AC 4), enforced on submission too:
  // a banked exercise for a concept whose prerequisites aren't Practiced
  // must not be submittable — passing it would advance the Learner Model
  // to `practiced` out of order and flip the curriculum step to complete.
  // Hardcoded v1 seeds carry no concept links and pass trivially. A
  // Tactical Sprint (Class B) exercise is exempt (issue #14 Round 3) — the
  // same exemption generation already applied — read from the persisted
  // row rather than a submission-time input, since a learner-supplied flag
  // here would let anyone bypass the gate on any exercise.
  const conceptIds = await getExerciseConceptIds(exercise.id)
  if (conceptIds.length > 0 && !exercise.sprintScoped) {
    await assertPrerequisitesPracticed({
      learnerId: input.learnerId,
      language: exercise.language,
      conceptIds,
    })
  }

  const sandboxResult = parseSandboxResult(
    await runSandboxSubmission({
      language: exercise.language,
      code: input.code,
      testSource: exercise.testSource,
    }),
  )

  const timeToSolution = await computeTimeToSolutionSeconds(
    input.learnerId,
    exercise.id,
  )

  const [attempt] = await db
    .insert(attempts)
    .values({
      learnerId: input.learnerId,
      exerciseId: exercise.id,
      code: input.code,
      outcome: sandboxResult.passed ? 'pass' : 'fail',
      timeToSolution,
      compilerErrors: {
        tests: sandboxResult.tests,
        message: sandboxResult.message ?? null,
      },
    })
    .returning()

  if (!attempt) {
    throw new Error('The attempt insert returned no row.')
  }

  if (sandboxResult.passed) {
    const stage2Review = await runStage2Review(exercise, input.code)
    const stage2Passed = stage2Review === null || stage2Review.passed

    await recordAttemptOutcome(input.learnerId, exercise.id, true, stage2Passed)

    return {
      attemptId: attempt.id,
      result: sandboxResult,
      hint: null,
      stage2Review,
    }
  }

  await recordAttemptOutcome(input.learnerId, exercise.id, false, false)

  let hint: Hint | null = null
  // Best-effort auto-hint: silently skipped when the exercise has no
  // reference solution (unlike requestHint's explicit EXERCISE_NOT_HINTABLE),
  // because a failed submission must still be recorded and returned. Also
  // skipped for independent exercises — issue #14's curriculum step makes
  // them hint-free, so no automatic scaffolding may reach them either.
  if (
    exercise.referenceSolution !== null &&
    exercise.guidance !== 'independent'
  ) {
    try {
      const preferences = await getExplanationPreferences(input.learnerId)
      hint = await generateHint({
        language: exercise.language,
        exerciseTitle: exercise.title,
        exercisePrompt: exercise.prompt,
        sandboxResult,
        targetLevel: resolveTargetLevel([], 'next'),
        priorHints: [],
        referenceSolution: exercise.referenceSolution,
        depth: preferences.depth,
        ...(preferences.referenceFrame === null
          ? {}
          : { referenceFrame: preferences.referenceFrame }),
      })
    } catch (error) {
      if (!(error instanceof TeacherEngineError)) {
        throw error
      }
    }
  }

  if (hint) {
    await db.insert(attemptHints).values({
      attemptId: attempt.id,
      hintLevel: hint.level,
      content: hint.content,
    })
  }

  return {
    attemptId: attempt.id,
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
 * ladder, or a foreign attempt are rejected. Concurrent requests that
 * resolve the same level (two parallel reads of the same prior-hints list)
 * fail gracefully as `HINT_ESCALATION_INVALID` instead of surfacing a raw
 * unique-violation on the `attempt_hints_level_unique` index (issue #55).
 * The served hint is phrased at the learner's current explanation
 * depth/reference frame (issue #12), which is presentation only and never
 * changes `targetLevel`'s resolution.
 */
export async function requestHint(input: {
  attemptId: string
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

  const preferences = await getExplanationPreferences(input.learnerId)

  const hint = await generateHint({
    language: context.exercise.language,
    exerciseTitle: context.exercise.title,
    exercisePrompt: context.exercise.prompt,
    sandboxResult: context.result,
    targetLevel,
    priorHints: context.priorHints,
    referenceSolution: context.referenceSolution,
    depth: preferences.depth,
    ...(preferences.referenceFrame === null
      ? {}
      : { referenceFrame: preferences.referenceFrame }),
  })

  const inserted = await db
    .insert(attemptHints)
    .values({
      attemptId: input.attemptId,
      hintLevel: hint.level,
      content: hint.content,
    })
    .onConflictDoNothing({
      target: [attemptHints.attemptId, attemptHints.hintLevel],
    })
    .returning({ id: attemptHints.id })

  if (inserted.length === 0) {
    throw new ExerciseError('HINT_ESCALATION_INVALID')
  }

  return { hint }
}
