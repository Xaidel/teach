import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { db } from '#/db/client.server'
import { attempts, exerciseConcepts, learnerConceptMastery } from '#/db/schema'
import type { masteryState } from '#/db/schema'

export type MasteryState = (typeof masteryState.enumValues)[number]

/**
 * Total order over the five mastery states (ADR-0010, SPEC story 41).
 * Exported as the narrow, named entry point `tactical-sprint.server.ts`
 * imports (`arch_docs/dependency-rules.md`'s Feature Dependencies exception;
 * the import is one-way and `learners` never imports back) so the Tactical
 * Sprint (Class B, ticket #13) can rank a snippet's identified concepts by
 * mastery and pick the weakest without duplicating the ordering here.
 */
export const MASTERY_STATE_ORDER: Record<MasteryState, number> = {
  unknown: 0,
  introduced: 1,
  practiced: 2,
  demonstrated: 3,
  retained: 4,
}

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
