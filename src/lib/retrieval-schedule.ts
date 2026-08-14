/**
 * Single source of truth for the spaced-retrieval schedule (SPEC story 49,
 * ADR-0010, issue #18): the fixed 24h → 3d → 7d → 21d → 60d retention
 * schedule, mapped onto `retrieval_queue.schedule_stage` 0-4, plus the v1
 * priority-score heuristic and the remediation boost that marks a failed
 * retrieval.
 *
 * These constants and functions feed the `retrieval_queue` CHECK constraint
 * (`src/db/schema.ts`), the learner-model upsert write path
 * (`src/features/learners/retrieval-queue.server.ts`), the retrieval feature's
 * queue view and Refresher Test flow (`src/features/retrieval/`), and the
 * learner-facing queue UI — one coordinated edit rather than several
 * hardcoded intervals drifting apart.
 */

/** The number of days a concept sits before its next review, per stage 0-4. */
export const RETRIEVAL_SCHEDULE_DAYS: readonly number[] = [1, 3, 7, 21, 60]

/** The highest schedule stage (0-4 maps onto the five fixed intervals). */
export const RETRIEVAL_STAGE_MAX = RETRIEVAL_SCHEDULE_DAYS.length - 1

/**
 * The priority boost a failed retrieval adds to a queue row's
 * `priority_score` (PRD §23.4: "Failed retrieval decreases the interval and
 * schedules targeted remediation"). Deliberately far above any score the
 * recency/difficulty terms can reach in practice (days of overdue time plus
 * a 1-5 difficulty), so a concept whose last retrieval failed always sorts
 * above concepts that are merely overdue — the "Failed previous review"
 * bucket of PRD §23.1's example queue. The same constant marks the view's
 * High Priority bucket: a row's score is at or above the boost exactly when
 * its last recorded retrieval failed. Sized so the recency term would need
 * decades of overdue time to reach it — the boost, not overdue duration,
 * is what decides remediation priority.
 */
export const RETRIEVAL_REMEDIATION_PRIORITY_BOOST = 1_000_000

/** How strongly overdue time weighs in the priority score (hours * 2). */
const RETRIEVAL_PRIORITY_OVERDUE_WEIGHT = 2

/** How strongly concept difficulty weighs (difficulty 1-5 * 10). */
const RETRIEVAL_PRIORITY_DIFFICULTY_WEIGHT = 10

/**
 * The schedule stage a concept is at after a failed retrieval (PRD §23.4):
 * the interval decreases back to the shortest one — 24h — so the concept is
 * requeued quickly for remediation.
 */
export const RETRIEVAL_FAILURE_STAGE = 0

/**
 * The delay until a queue row first becomes due — the interval of stage 0
 * (24h), applied when a row is created for a concept's first interaction.
 */
export function retrievalStageDelayMs(stage: number): number {
  const days = RETRIEVAL_SCHEDULE_DAYS[stage]
  if (days === undefined) {
    throw new Error(
      `retrieval schedule stage ${String(stage)} is out of range 0-${String(RETRIEVAL_STAGE_MAX)}`,
    )
  }
  return days * 24 * 60 * 60 * 1000
}

/**
 * The stage a concept advances to after a successful retrieval: one stage
 * up, capped at the final 60-day stage (SPEC story 49 — the fixed schedule
 * has no stage beyond 4; adaptive interval lengthening is future work).
 */
export function retrievalNextStage(stage: number): number {
  return Math.min(stage + 1, RETRIEVAL_STAGE_MAX)
}

/**
 * The v1 priority-score heuristic (SPEC story 47: "prioritized by recency,
 * past performance, hint dependency, and importance" — ADR-0010 stores the
 * score as the inspectable materialized value). Defined here as a pure
 * function of the inputs available at upsert time:
 *
 * - recency: the number of hours the row is already overdue (0 until due),
 *   weighted `RETRIEVAL_PRIORITY_OVERDUE_WEIGHT` — the longer past due, the
 *   more urgent;
 * - importance: the concept's 1-5 difficulty as the only v1 proxy for
 *   concept importance, weighted `RETRIEVAL_PRIORITY_DIFFICULTY_WEIGHT`;
 * - performance: `RETRIEVAL_REMEDIATION_PRIORITY_BOOST` when the retrieval
 *   being recorded failed (a successful retrieval never carries the boost).
 *
 * Hint dependency is not represented in v1 (no scheduling consumer exists
 * yet — ADR-0025 defers it to the same follow-up lane as the recurring
 * mistakes evidence). Higher score = more urgent; the queue view orders by
 * it.
 */
export function computeRetrievalPriorityScore(input: {
  /** The row's current `due_at`, or null when the row is first created. */
  dueAt: Date | null
  /** The time the score is computed for (the upsert moment). */
  now: Date
  /** The concept's 1-5 difficulty. */
  difficulty: number
  /** Whether the retrieval being recorded failed (remediation boost). */
  failedLastReview: boolean
}): number {
  const overdueMs = input.dueAt
    ? input.now.getTime() - input.dueAt.getTime()
    : 0
  const overdueHours = Math.max(0, overdueMs) / (60 * 60 * 1000)
  return (
    overdueHours * RETRIEVAL_PRIORITY_OVERDUE_WEIGHT +
    input.difficulty * RETRIEVAL_PRIORITY_DIFFICULTY_WEIGHT +
    (input.failedLastReview ? RETRIEVAL_REMEDIATION_PRIORITY_BOOST : 0)
  )
}

/** Whether a stored priority score marks its row as a remediation item. */
export function isRetrievalRemediationScore(priorityScore: number): boolean {
  return priorityScore >= RETRIEVAL_REMEDIATION_PRIORITY_BOOST
}
