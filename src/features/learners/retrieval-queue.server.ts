import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { concepts, retrievalQueue, retrievalReviewExercises } from '#/db/schema'
import {
  RETRIEVAL_FAILURE_STAGE,
  computeRetrievalPriorityScore,
  retrievalNextStage,
  retrievalStageDelayMs,
} from '#/lib/retrieval-schedule'

/**
 * The two outcomes a recorded attempt or mastery change feeds the Retrieval
 * Queue (issue #18): a full completion (`success` — Stage 1 and Stage 2
 * both passed, or a passed assessment) is a successful retrieval; anything
 * else is a failure. See `upsertRetrievalQueue`.
 */
export type RetrievalOutcome = 'success' | 'failure'

/**
 * One retrieval_queue row as stored (ADR-0010, issue #18). Read at the
 * `retrieval` feature's boundary; the queue view annotates these with the
 * concept's graph/mastery data and splits them into its priority buckets.
 */
export type RetrievalQueueRow = {
  conceptId: string
  scheduleStage: number
  dueAt: Date
  priorityScore: number
}

/**
 * Keeps the materialized Retrieval Queue in sync with the Learner Model
 * (ADR-0010's synchronous-upsert invariant, SPEC story 47, issue #18 AC 1):
 * called inline by every code path that records an attempt or a mastery
 * change — `recordAttemptOutcome`, `recordExplanationAssessmentOutcome`,
 * `recordTransferTestOutcome` (`mastery.server.ts`). Never a background
 * job in v1.
 *
 * Semantics (ADR-0029, `docs/adr/0029-spaced-retrieval-queue.md`):
 *
 * - No row exists yet: created at `schedule_stage` 0, due one 24h interval
 *   out — the fixed schedule starts with the concept's first interaction.
 * - `success`: the concept advances one schedule stage (capped at the final
 *   60-day stage) and is due one interval of the new stage out — "based on
 *   last successful retrieval" (AC 2); a successful retrieval increases the
 *   interval (PRD §23.4).
 * - `failure`: the stage resets to 0 and the concept is due 24h out, with
 *   the remediation priority boost applied — a failed retrieval decreases
 *   the interval and schedules targeted remediation (PRD §23.4).
 *
 * The priority score is recomputed from the previous row's `due_at`, the
 * concept's difficulty, and the outcome being recorded — the stored,
 * inspectable value ADR-0010 chose the materialized table for.
 */
export async function upsertRetrievalQueue(input: {
  learnerId: string
  conceptId: string
  outcome: RetrievalOutcome
}): Promise<void> {
  const [existing, concept] = await Promise.all([
    db.query.retrievalQueue.findFirst({
      where: and(
        eq(retrievalQueue.learnerId, input.learnerId),
        eq(retrievalQueue.conceptId, input.conceptId),
      ),
    }),
    db.query.concepts.findFirst({
      where: eq(concepts.id, input.conceptId),
      columns: { difficulty: true },
    }),
  ])

  const now = new Date()
  const failed = input.outcome === 'failure'
  // A failure resets to stage 0; a success advances the existing stage by
  // one. A brand-new row is created at stage 0 — the schedule starts with
  // the concept's first interaction and the first *success* advances it.
  const stage = failed
    ? RETRIEVAL_FAILURE_STAGE
    : existing
      ? retrievalNextStage(existing.scheduleStage)
      : RETRIEVAL_FAILURE_STAGE
  const dueAt = new Date(now.getTime() + retrievalStageDelayMs(stage))
  const priorityScore = computeRetrievalPriorityScore({
    dueAt: existing?.dueAt ?? null,
    now,
    difficulty: concept?.difficulty ?? 1,
    failedLastReview: failed,
  })

  await db
    .insert(retrievalQueue)
    .values({
      learnerId: input.learnerId,
      conceptId: input.conceptId,
      scheduleStage: stage,
      dueAt,
      priorityScore,
    })
    .onConflictDoUpdate({
      target: [retrievalQueue.learnerId, retrievalQueue.conceptId],
      set: {
        scheduleStage: stage,
        dueAt,
        priorityScore,
      },
    })
}

/**
 * Every Retrieval Queue row for one learner, as stored (issue #18). The
 * `retrieval` feature's view annotates and buckets these; the table stays
 * the flat, indexed materialized read ADR-0010 chose.
 */
export async function getRetrievalQueueEntries(
  learnerId: string,
): Promise<RetrievalQueueRow[]> {
  const rows = await db
    .select({
      conceptId: retrievalQueue.conceptId,
      scheduleStage: retrievalQueue.scheduleStage,
      dueAt: retrievalQueue.dueAt,
      priorityScore: retrievalQueue.priorityScore,
    })
    .from(retrievalQueue)
    .where(eq(retrievalQueue.learnerId, learnerId))

  return rows.map((row) => ({
    conceptId: row.conceptId,
    scheduleStage: row.scheduleStage,
    dueAt: row.dueAt,
    priorityScore: row.priorityScore,
  }))
}

/**
 * Registers the exercise a Refresher Test session on one concept uses
 * (issue #18) — a pointer, not a new entity (see `retrievalReviewExercises`
 *'s doc comment, `src/db/schema.ts`), mirroring the Transfer Test
 * registration. Unlike the Transfer Test's no-op-on-conflict reuse, a
 * Refresher Test session always overwrites: each review can pick a
 * different exercise, and an abandoned session is simply replaced by the
 * next one.
 */
export async function registerRetrievalReviewExercise(input: {
  learnerId: string
  conceptId: string
  exerciseId: string
}): Promise<void> {
  await db
    .insert(retrievalReviewExercises)
    .values(input)
    .onConflictDoUpdate({
      target: [
        retrievalReviewExercises.learnerId,
        retrievalReviewExercises.conceptId,
      ],
      set: { exerciseId: input.exerciseId, createdAt: sql`now()` },
    })
}

/**
 * The concept a submitted exercise counts as a Refresher Test for, or null
 * when the exercise isn't any concept's registered review exercise for this
 * learner (issue #18). `recordAttemptOutcome` (`mastery.server.ts`) uses
 * this to detect a review submission reached through the *general* practice
 * submission path — a Refresher Test is an ordinary verified `exercises`
 * row (ADR-0010), so it is solved through the practice list like any other
 * exercise, and the review's pass/fail semantics are applied keyed off this
 * registration.
 */
export async function findRetrievalReviewConceptForExercise(input: {
  learnerId: string
  exerciseId: string
}): Promise<string | null> {
  const row = await db.query.retrievalReviewExercises.findFirst({
    where: and(
      eq(retrievalReviewExercises.learnerId, input.learnerId),
      eq(retrievalReviewExercises.exerciseId, input.exerciseId),
    ),
  })
  return row?.conceptId ?? null
}

/**
 * The exercise id a Refresher Test session on one concept is currently
 * using, or null before the first session (issue #18) — lets the retrieval
 * feature resolve an in-progress review back to its exercise instead of
 * replacing it on a second start.
 */
export async function getRetrievalReviewExerciseId(input: {
  learnerId: string
  conceptId: string
}): Promise<string | null> {
  const row = await db.query.retrievalReviewExercises.findFirst({
    where: and(
      eq(retrievalReviewExercises.learnerId, input.learnerId),
      eq(retrievalReviewExercises.conceptId, input.conceptId),
    ),
  })
  return row?.exerciseId ?? null
}
