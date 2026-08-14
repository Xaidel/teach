import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { db } from '#/db/client.server'
import {
  attempts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
} from '#/db/schema'
// Shared constant, not an explanation-assessment import: the pass definition
// is consumed by the EA feature's formula AND this gate read, and `learners`
// must stay one-way downstream of `explanation-assessment`.
import { EXPLANATION_ACCURACY_PASS_THRESHOLD } from '#/lib/explanation-accuracy'
// Shared constant (src/lib/mastery-states.ts): the state vocabulary is
// consumed by the DB enum, this feature's rank comparisons, and two
// features' display-only schema mirrors — no single feature owner.
import { MASTERY_STATE_ORDER, type MasteryState } from '#/lib/mastery-states'
// The ADR-0015 gate's Transfer Test half (issue #17): its own module,
// same feature, so the pointer-table bookkeeping it needs
// (`transferTestExercises`, ADR-0010) stays out of this file.
import {
  findTransferTestConceptForExercise,
  hasPassedTransferTest,
  markTransferTestExercisePassed,
} from './transfer-test.server'
import {
  findRetrievalReviewConceptForExercise,
  upsertRetrievalQueue,
} from './retrieval-queue.server'

/**
 * Total order over the five mastery states (ADR-0010, SPEC story 41) —
 * `MASTERY_STATE_ORDER` from the shared constant, used here for the rank
 * comparison inside `advanceMastery`'s atomic upsert and the gate guards.
 */

/**
 * The mastery states that satisfy a prerequisite (SPEC story 41, issue #14):
 * the Learner Model's definition of "Practiced or better", shared by every
 * caller that gates on it (the curriculum's no-skip-ahead rule, AC 4).
 */
export const PRACTICED_OR_BETTER: readonly MasteryState[] = [
  'practiced',
  'demonstrated',
  'retained',
]

/** Whether a mastery state counts as Practiced (the curriculum's gate). */
export function isPracticedOrBetter(state: MasteryState): boolean {
  return PRACTICED_OR_BETTER.includes(state)
}

/**
 * Whether every one of these concept ids is Practiced or better in an
 * already-loaded mastery map (issue #14, AC 4) — the shared "all
 * prerequisites Practiced" predicate over data the caller already fetched.
 * Two callers share this exact shape: `concepts.server.ts`'s
 * `assertPrerequisitesPracticed` (the no-skip-ahead gate, which loads the
 * graph and mastery itself) and `curriculum.server.ts`'s `buildCurriculum`
 * (which batch-loads mastery once for every step up front — a non-throwing
 * async sibling of the gate would reintroduce the N+1 that batching avoids,
 * so this stays a pure function over already-loaded data instead).
 */
export function allPracticedOrBetter(
  conceptIds: Iterable<string>,
  mastery: Record<string, MasteryState>,
): boolean {
  return [...conceptIds].every((id) =>
    isPracticedOrBetter(mastery[id] ?? 'unknown'),
  )
}

/** Maps a mastery-state column's value to its rank for a SQL comparison. */
function masteryStateRank(column: AnyPgColumn) {
  return sql`(case ${column} ${sql.join(
    (Object.keys(MASTERY_STATE_ORDER) as MasteryState[]).map(
      (state) => sql`when ${state} then ${MASTERY_STATE_ORDER[state]}`,
    ),
    sql` `,
  )} end)`
}

/**
 * Resolves the Concept Graph concepts an exercise targets (ADR-0010's
 * `exercise_concepts` join). Hardcoded v1 seed exercises have no rows here
 * and resolve to an empty list — mastery advancement is a no-op for them.
 */
export async function getExerciseConceptIds(
  exerciseId: string,
): Promise<string[]> {
  const rows = await db
    .select({ conceptId: exerciseConcepts.conceptId })
    .from(exerciseConcepts)
    .where(eq(exerciseConcepts.exerciseId, exerciseId))

  return rows.map((row) => row.conceptId)
}

/**
 * Advances each concept's `learner_concept_mastery` row to `targetState`,
 * attributed to `learnerId` (ADR-0010, ADR-0014). Never regresses a
 * concept already at or past `targetState` — the upsert's `where` clause
 * compares mastery-state rank atomically, in the same round trip as the
 * write, so a concurrent advance to a higher state can never be clobbered
 * by a slower request settling on a lower one. A concept with no prior row
 * is created at `targetState` directly (Unknown is the implicit absence of
 * a row, never written explicitly here). Attempted concepts with an empty
 * list (hardcoded seed exercises) are a no-op.
 */
export async function advanceMastery(
  learnerId: string,
  conceptIds: string[],
  targetState: MasteryState,
): Promise<void> {
  if (conceptIds.length === 0) return

  await db.transaction(async (tx) => {
    for (const conceptId of conceptIds) {
      await tx
        .insert(learnerConceptMastery)
        .values({ learnerId, conceptId, state: targetState })
        .onConflictDoUpdate({
          target: [
            learnerConceptMastery.learnerId,
            learnerConceptMastery.conceptId,
          ],
          set: { state: targetState, updatedAt: sql`now()` },
          where: sql`${masteryStateRank(learnerConceptMastery.state)} < ${MASTERY_STATE_ORDER[targetState]}`,
        })
    }
  })
}

/**
 * Records one exercise attempt's outcome against the Learner Model
 * (ADR-0010, ADR-0021, ticket #10's acceptance criteria) — the single
 * intent-level entry point the `exercise` feature reports into (see
 * `arch_docs/dependency-rules.md`'s Feature Dependencies exception; the
 * import is one-way and `learners` never imports back). Any attempt, pass
 * or fail, advances its exercise's concepts to at least `introduced`
 * (attributing failed attempts to the right learner + concept);
 * `stage1Passed && stage2Passed` — a full completion — additionally
 * advances them to `practiced`. Hardcoded seed exercises have no
 * `exercise_concepts` rows and this is a no-op for them.
 *
 * Two further responsibilities, both keyed off the same full-completion
 * definition:
 *
 * - Retrieval Queue sync (ADR-0010, issue #18): every concept the exercise
 *   targets is upserted into the materialized `retrieval_queue` — a full
 *   completion is a successful retrieval (stage advances), anything else is
 *   a failed one (stage resets, remediation scheduled). See
 *   `upsertRetrievalQueue`.
 * - Refresher Test semantics (issue #18, AC 4/5): when the submitted
 *   exercise is the learner's registered Refresher Test for a concept
 *   (`findRetrievalReviewConceptForExercise`), a full completion promotes
 *   that concept to Retained; a failure reverts it to Practiced (never
 *   below — see `revertToPracticed`) and routes it to remediation via the
 *   queue's failure reset. Prior attempt history is never touched.
 */
export async function recordAttemptOutcome(
  learnerId: string,
  exerciseId: string,
  stage1Passed: boolean,
  stage2Passed: boolean,
): Promise<void> {
  const conceptIds = await getExerciseConceptIds(exerciseId)
  if (conceptIds.length === 0) return

  await advanceMastery(learnerId, conceptIds, 'introduced')

  if (stage1Passed && stage2Passed) {
    await advanceMastery(learnerId, conceptIds, 'practiced')
  }

  // Transfer Test (ADR-0015, ADR-0010, ADR-0027, issue #17): a learner may
  // submit their registered Transfer Test exercise through this general
  // practice path instead of the dedicated Transfer Test flow — it is an
  // ordinary debug-mode `exercises` row (ADR-0010), not a separate
  // submission surface. `stage1Passed && stage2Passed` mirrors Practiced's
  // own bar exactly — a Transfer Test that only clears Stage 1 is no
  // stronger evidence of transfer than a submission that never reached
  // Practiced in the first place. This internal pass path applies the
  // gate without its own queue upsert — the single upsert loop below
  // records the retrieval for every concept of this exercise exactly once.
  if (stage1Passed && stage2Passed) {
    const transferConceptId = await findTransferTestConceptForExercise({
      learnerId,
      exerciseId,
    })
    if (transferConceptId) {
      await recordTransferTestPass({
        learnerId,
        conceptId: transferConceptId,
      })
    }
  }

  // Refresher Test (issue #18, AC 4/5): a full completion of a registered
  // review exercise promotes the reviewed concept to Retained; a failure
  // reverts it to Practiced and relies on the queue failure reset below for
  // the remediation routing. History is preserved either way.
  const reviewConceptId = await findRetrievalReviewConceptForExercise({
    learnerId,
    exerciseId,
  })
  if (reviewConceptId) {
    if (stage1Passed && stage2Passed) {
      await advanceMastery(learnerId, [reviewConceptId], 'retained')
    } else {
      await revertToPracticed({ learnerId, conceptId: reviewConceptId })
    }
  }

  // Retrieval Queue sync (ADR-0010, issue #18 AC 1): one upsert per
  // concept, after the mastery and review branches above, so a review
  // submission's interval reflects its actual outcome and nothing advances
  // the queue twice for the same retrieval.
  const successful = stage1Passed && stage2Passed
  for (const conceptId of conceptIds) {
    await upsertRetrievalQueue({
      learnerId,
      conceptId,
      outcome: successful ? 'success' : 'failure',
    })
  }
}

/**
 * Reads the current mastery state for one learner's concepts. A concept
 * with no row is Unknown (the implicit absence state, ADR-0010) — callers
 * get it back explicitly rather than needing to interpret a missing entry.
 */
export async function getMasteryStates(
  learnerId: string,
  conceptIds: string[],
): Promise<Record<string, MasteryState>> {
  if (conceptIds.length === 0) return {}

  const rows = await db
    .select({
      conceptId: learnerConceptMastery.conceptId,
      state: learnerConceptMastery.state,
    })
    .from(learnerConceptMastery)
    .where(
      and(
        eq(learnerConceptMastery.learnerId, learnerId),
        inArray(learnerConceptMastery.conceptId, conceptIds),
      ),
    )

  const states: Record<string, MasteryState> = {}
  for (const conceptId of conceptIds) {
    states[conceptId] = 'unknown'
  }
  for (const row of rows) {
    states[row.conceptId] = row.state
  }
  return states
}

/** One concept the learner has repeatedly failed, with its evidence. */
export type RecurringMistakeEvidence = {
  conceptId: string
  failedAttemptCount: number
  latestFailedAt: Date
}

/**
 * Surfaces "recurring mistakes" evidence from the Learner Model (SPEC
 * story 42, ADR-0025): the concepts this learner has failed at least
 * twice, counted over the persisted `attempts` rows via the
 * `exercise_concepts` join. No dedicated column or table exists — the
 * raw evidence is aggregated at read time from the rows issue #10 already
 * persists, exactly the documented query pattern ADR-0025 chooses. The
 * count is per concept, not per attempt: a failed attempt on a
 * multi-concept exercise is counted once per joined `exercise_concepts`
 * row. The more speculative consumers (clustering `compiler_errors` into
 * repeated failure *patterns*, `attempt_hints` escalation signals) are
 * explicitly deferred until a remediation/scheduling consumer exists
 * (issues #16-#18, Retrieval Queue) — see ADR-0025. Sorted by failure
 * count, most repeated first.
 */
export async function getRecurringMistakeEvidence(
  learnerId: string,
): Promise<RecurringMistakeEvidence[]> {
  const rows = await db
    .select({
      conceptId: exerciseConcepts.conceptId,
      failedAttemptCount: sql<number>`count(${attempts.id})::int`,
      latestFailedAt: sql<Date>`max(${attempts.createdAt})`,
    })
    .from(attempts)
    .innerJoin(
      exerciseConcepts,
      eq(exerciseConcepts.exerciseId, attempts.exerciseId),
    )
    .where(and(eq(attempts.learnerId, learnerId), eq(attempts.outcome, 'fail')))
    .groupBy(exerciseConcepts.conceptId)
    .having(sql`count(${attempts.id}) >= 2`)
    .orderBy(desc(sql`count(${attempts.id})`))

  return rows
}

/**
 * Whether the learner has a passed Explanation Assessment recorded for the
 * concept (issue #16): any explain-mode attempt row whose recorded
 * `explanation_assessment` payload scores at or above the pass threshold.
 * This is the Learner Model's evidence read for ADR-0015's Practiced →
 * Demonstrated gate — the EA feature writes the evidence through
 * `recordExplanationAssessmentOutcome` and never reaches into the
 * attempts/exercises join itself.
 *
 * The verdict is re-derived from the payload score, not from `attempts
 * .outcome`: explain-mode attempts write NULL outcome (no Stage 1 sandbox
 * verdict, ADR-0010/ADR-0021), and the payload is the single source of
 * truth for the accuracy signal.
 */
export async function hasPassedExplanationAssessment(
  learnerId: string,
  conceptId: string,
): Promise<boolean> {
  const conceptIds = await getPassedExplanationAssessmentConceptIds(learnerId, [
    conceptId,
  ])
  return conceptIds.length > 0
}

/**
 * The subset of `conceptIds` the learner has a passed Explanation
 * Assessment recorded for (issue #16) — the batched evidence read behind
 * `hasPassedExplanationAssessment`, kept as its own function so the
 * explanation-assessment feature's overview can annotate a whole list of
 * eligible concepts without an n+1. "Passed" is re-derived from the
 * payload's accuracy score against the shared threshold — see
 * `hasPassedExplanationAssessment`.
 */
export async function getPassedExplanationAssessmentConceptIds(
  learnerId: string,
  conceptIds: string[],
): Promise<string[]> {
  if (conceptIds.length === 0) return []

  const rows = await db
    .selectDistinct({ conceptId: exerciseConcepts.conceptId })
    .from(attempts)
    .innerJoin(exercises, eq(exercises.id, attempts.exerciseId))
    .innerJoin(exerciseConcepts, eq(exerciseConcepts.exerciseId, exercises.id))
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        inArray(exerciseConcepts.conceptId, conceptIds),
        eq(exercises.mode, 'explain'),
        sql`(${attempts.explanationAssessment}->>'accuracyScore')::double precision >= ${EXPLANATION_ACCURACY_PASS_THRESHOLD}`,
      ),
    )

  return rows.map((row) => row.conceptId)
}

/**
 * The ADR-0015 Practiced → Demonstrated gate (issue #16): promotes the
 * concept only when BOTH required signals are recorded — a passed
 * Explanation Assessment and a passed Transfer Test — independently and in
 * no fixed order, and only from the `practiced` state itself. A concept
 * with only one signal (or neither) stays at Practiced, retryable.
 * Promotion never regresses: the update's `state = 'practiced'` guard means
 * a concurrent advance to a higher state can never be clobbered, mirroring
 * `advanceMastery`'s atomicity intent. Returns the concept's state after
 * the attempt.
 */
export async function promoteToDemonstrated(input: {
  learnerId: string
  conceptId: string
}): Promise<MasteryState> {
  const explanationPassed = await hasPassedExplanationAssessment(
    input.learnerId,
    input.conceptId,
  )
  const transferPassed = await hasPassedTransferTest(
    input.learnerId,
    input.conceptId,
  )

  if (!explanationPassed || !transferPassed) {
    return (
      (await getMasteryStates(input.learnerId, [input.conceptId]))[
        input.conceptId
      ] ?? 'unknown'
    )
  }

  const [updated] = await db
    .update(learnerConceptMastery)
    .set({ state: 'demonstrated', updatedAt: sql`now()` })
    .where(
      and(
        eq(learnerConceptMastery.learnerId, input.learnerId),
        eq(learnerConceptMastery.conceptId, input.conceptId),
        eq(learnerConceptMastery.state, 'practiced'),
      ),
    )
    .returning({ state: learnerConceptMastery.state })

  if (updated) {
    return updated.state
  }

  return (
    (await getMasteryStates(input.learnerId, [input.conceptId]))[
      input.conceptId
    ] ?? 'unknown'
  )
}

/**
 * Reverts one concept's mastery to Practiced — the Learner Model's
 * explicit downgrade path (SPEC story 50, issue #18 AC 5: a failed
 * Refresher Test reverts the concept's status). Atomic and guarded: the
 * update's `where` clause only fires when the current state ranks *above*
 * Practiced (Demonstrated or Retained), so a concept at or below Practiced
 * is never touched — a failed review never kicks a merely-practiced
 * concept back down, and a concurrent advance can never be clobbered.
 * Prior attempt history is deliberately preserved (AC 5) — only the
 * current-state row changes.
 */
export async function revertToPracticed(input: {
  learnerId: string
  conceptId: string
}): Promise<void> {
  await db
    .update(learnerConceptMastery)
    .set({ state: 'practiced', updatedAt: sql`now()` })
    .where(
      and(
        eq(learnerConceptMastery.learnerId, input.learnerId),
        eq(learnerConceptMastery.conceptId, input.conceptId),
        sql`${masteryStateRank(learnerConceptMastery.state)} > ${MASTERY_STATE_ORDER.practiced}`,
      ),
    )
}

/**
 * The mastery side of a passed Transfer Test (issue #17, ADR-0027) —
 * marks the registered instance passed and fires the ADR-0015 gate. The
 * shared core behind both `recordTransferTestOutcome` (public entry point,
 * which also syncs the Retrieval Queue) and `recordAttemptOutcome`'s
 * internal pass path (which must not — its own single queue upsert covers
 * the retrieval). A failed Transfer Test never reaches this: it is only
 * called with `passed: true` from `recordAttemptOutcome`.
 */
async function recordTransferTestPass(input: {
  learnerId: string
  conceptId: string
}): Promise<void> {
  await markTransferTestExercisePassed(input)
  await promoteToDemonstrated(input)
}

/**
 * Records one Explanation Assessment outcome against the Learner Model
 * (issue #16) — the single intent-level entry point the explanation-
 * assessment feature reports into (see `arch_docs/dependency-rules.md`'s
 * Feature Dependencies exception; the import is one-way and `learners`
 * never imports back). A passed assessment feeds ADR-0015's gate: the
 * concept promotes Practiced → Demonstrated only when a passed Transfer
 * Test is also recorded (`promoteToDemonstrated`). A failed initial-gate
 * attempt leaves the concept at Practiced with a retry available — the
 * attempt itself is the evidence, and mastery never regresses on a failure
 * (ADR-0015).
 *
 * Either way, the Retrieval Queue is kept in sync (ADR-0010, issue #18): a
 * passed assessment is a successful retrieval (stage advances), a failed
 * one resets the interval and schedules remediation — the assessment is
 * itself a retrieval, so its outcome feeds the schedule like any other.
 */
export async function recordExplanationAssessmentOutcome(input: {
  learnerId: string
  conceptId: string
  passed: boolean
}): Promise<void> {
  await upsertRetrievalQueue({
    learnerId: input.learnerId,
    conceptId: input.conceptId,
    outcome: input.passed ? 'success' : 'failure',
  })

  if (!input.passed) return

  await promoteToDemonstrated({
    learnerId: input.learnerId,
    conceptId: input.conceptId,
  })
}

/**
 * Records one Transfer Test outcome against the Learner Model (issue #17,
 * ADR-0027) — the single intent-level entry point the transfer-test
 * feature reports into (see `arch_docs/dependency-rules.md`'s Feature
 * Dependencies exception; the import is one-way and `learners` never
 * imports back). A passed Transfer Test durably marks the registered
 * instance passed and feeds ADR-0015's gate, promoting the concept
 * Practiced → Demonstrated only when a passed Explanation Assessment is
 * also recorded (`promoteToDemonstrated`). A failed initial-gate attempt
 * leaves the concept at Practiced with a retry available — every attempt
 * is recorded as evidence, and mastery never regresses on a failure
 * (ADR-0015).
 *
 * Either way, the Retrieval Queue is kept in sync (ADR-0010, issue #18):
 * a passed test is a successful retrieval (stage advances), a failed one
 * resets the interval and schedules remediation. When called from
 * `recordAttemptOutcome`'s internal pass path, the queue is instead
 * synced once by that function itself (`recordTransferTestPass`).
 */
export async function recordTransferTestOutcome(input: {
  learnerId: string
  conceptId: string
  passed: boolean
}): Promise<void> {
  await upsertRetrievalQueue({
    learnerId: input.learnerId,
    conceptId: input.conceptId,
    outcome: input.passed ? 'success' : 'failure',
  })

  if (!input.passed) return

  await recordTransferTestPass(input)
}

/**
 * Whether the learner has a `pass`-outcome attempt against any exercise of
 * `mode` targeting the concept (ADR-0015, issue #17) — the Transfer Test
 * generation path's "has the learner already faced this shape" read, so it
 * can pick a genuinely different one (AC1: "using a different exercise
 * shape than the one originally solved"). Deliberately broader than "the
 * one specific attempt that flipped this concept to Practiced": any
 * Stage-1-passing attempt in a shape is treated as the learner having
 * already faced it, since the practice list's adversarial toggle (issue
 * #11) lets a learner reach Practiced via a debug-mode exercise through
 * ordinary practice, not only through this feature's own generation.
 */
export async function hasPassedExerciseModeForConcept(
  learnerId: string,
  conceptId: string,
  mode: 'implement' | 'debug',
): Promise<boolean> {
  const [row] = await db
    .select({ exerciseId: exercises.id })
    .from(attempts)
    .innerJoin(exercises, eq(exercises.id, attempts.exerciseId))
    .innerJoin(exerciseConcepts, eq(exerciseConcepts.exerciseId, exercises.id))
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        eq(exerciseConcepts.conceptId, conceptId),
        eq(exercises.mode, mode),
        eq(attempts.outcome, 'pass'),
      ),
    )
    .limit(1)

  return row !== undefined
}

// Cross-feature evidence read (issue #17): the transfer-test feature's
// overview annotates its eligible-concepts list with "already passed" the
// same way the explanation-assessment feature does for its own signal —
// through this single named entry point, never `transfer-test.server.ts`'s
// lower-level primitives directly (see the Feature Dependencies exception).
export {
  getPassedTransferTestConceptIds,
  hasPassedTransferTest,
} from './transfer-test.server'
