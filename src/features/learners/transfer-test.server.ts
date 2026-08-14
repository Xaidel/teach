import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { transferTestExercises } from '#/db/schema'

/**
 * Registers the exercise generated for one learner's Transfer Test on one
 * concept (ADR-0015, ADR-0010, issue #17) — a pointer, not a new entity
 * (see `transferTestExercises`'s doc comment, `src/db/schema.ts`). Called
 * once by the `transfer-test` feature's generation path; a second call for
 * the same `(learnerId, conceptId)` is a no-op — a learner always retries
 * against the same generated instance, mirroring Explanation Assessment's
 * `ensureExplainExercise` reuse (issue #16).
 */
export async function registerTransferTestExercise(input: {
  learnerId: string
  conceptId: string
  exerciseId: string
}): Promise<void> {
  await db
    .insert(transferTestExercises)
    .values(input)
    .onConflictDoNothing({
      target: [
        transferTestExercises.learnerId,
        transferTestExercises.conceptId,
      ],
    })
}

/**
 * The exercise id already assigned as one learner's Transfer Test for one
 * concept, or null before the first generation (issue #17) — lets the
 * generation path reuse the existing instance instead of minting a second
 * one for the same concept.
 */
export async function getTransferTestExerciseId(input: {
  learnerId: string
  conceptId: string
}): Promise<string | null> {
  const row = await db.query.transferTestExercises.findFirst({
    where: and(
      eq(transferTestExercises.learnerId, input.learnerId),
      eq(transferTestExercises.conceptId, input.conceptId),
    ),
  })
  return row?.exerciseId ?? null
}

/**
 * The concept a passing exercise id counts as Transfer Test evidence for,
 * or null when the exercise isn't any concept's registered Transfer Test
 * for this learner (issue #17). `recordAttemptOutcome`
 * (`mastery.server.ts`) uses this to detect a Transfer Test pass reached
 * through the *general* practice submission path: a Transfer Test exercise
 * is an ordinary debug-mode `exercises` row (ADR-0010), so a learner may
 * submit it via the practice list rather than the dedicated Transfer Test
 * flow — either route counts, since it's the same structurally-different
 * instance either way.
 */
export async function findTransferTestConceptForExercise(input: {
  learnerId: string
  exerciseId: string
}): Promise<string | null> {
  const row = await db.query.transferTestExercises.findFirst({
    where: and(
      eq(transferTestExercises.learnerId, input.learnerId),
      eq(transferTestExercises.exerciseId, input.exerciseId),
    ),
  })
  return row?.conceptId ?? null
}

/**
 * Marks one learner's registered Transfer Test exercise for one concept as
 * passed (ADR-0015, ADR-0027, issue #17) — the durable write behind
 * `hasPassedTransferTest`. Called once by `recordAttemptOutcome`
 * (`mastery.server.ts`) the moment it observes a full pass (Stage 1 *and*
 * Stage 2, matching Practiced's own bar) against the learner's registered
 * instance. Written as a one-way flag, never unset: idempotent, and a
 * concurrent/later call is a no-op once already true. This is a write, not
 * a re-derived read, because Stage 2's rubric result is never persisted on
 * `attempts` (only Stage 1's `outcome` is) — there is nothing a
 * retrospective query against `attempts` could consult for Stage 2, so the
 * pass verdict must be captured durably at the moment both stages are known
 * (submission time), not reconstructed later.
 */
export async function markTransferTestExercisePassed(input: {
  learnerId: string
  conceptId: string
}): Promise<void> {
  await db
    .update(transferTestExercises)
    .set({ passed: true })
    .where(
      and(
        eq(transferTestExercises.learnerId, input.learnerId),
        eq(transferTestExercises.conceptId, input.conceptId),
      ),
    )
}

/**
 * Whether the learner has a passed Transfer Test recorded for the concept
 * (issue #17, ADR-0027): the durable `passed` flag on the exercise instance
 * registered as this learner's Transfer Test for the concept
 * (`transferTestExercises`), set once by `markTransferTestExercisePassed`
 * when both Stage 1 and Stage 2 pass. This is the Learner Model's evidence
 * read for ADR-0015's Practiced → Demonstrated gate — the Transfer Test
 * feature reports through `recordTransferTestOutcome` and never reaches
 * into `attempts` itself.
 */
export async function hasPassedTransferTest(
  learnerId: string,
  conceptId: string,
): Promise<boolean> {
  const conceptIds = await getPassedTransferTestConceptIds(learnerId, [
    conceptId,
  ])
  return conceptIds.length > 0
}

/**
 * The subset of `conceptIds` the learner has a passed Transfer Test
 * recorded for (issue #17, ADR-0027) — the batched evidence read behind
 * `hasPassedTransferTest`, kept as its own function so the transfer-test
 * feature's overview can annotate a whole list of eligible concepts without
 * an n+1, mirroring `getPassedExplanationAssessmentConceptIds`.
 */
export async function getPassedTransferTestConceptIds(
  learnerId: string,
  conceptIds: string[],
): Promise<string[]> {
  if (conceptIds.length === 0) return []

  const rows = await db
    .select({ conceptId: transferTestExercises.conceptId })
    .from(transferTestExercises)
    .where(
      and(
        eq(transferTestExercises.learnerId, learnerId),
        inArray(transferTestExercises.conceptId, conceptIds),
        eq(transferTestExercises.passed, true),
      ),
    )

  return rows.map((row) => row.conceptId)
}
