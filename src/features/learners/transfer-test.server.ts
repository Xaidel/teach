import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { attempts, transferTestExercises } from '#/db/schema'

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
 * Whether the learner has a passed Transfer Test recorded for the concept
 * (issue #17): a `pass` outcome on the exercise instance registered as this
 * learner's Transfer Test for the concept (`transferTestExercises`). Stage
 * 1's deterministic sandbox verdict is the sole bar — Stage 1 stays the
 * authoritative gate (ADR-0008, mirrored by `attempts.outcome`'s own doc
 * comment); a Stage 2 qualitative rubric review, when the generic
 * submission path happens to run one, is informational only and never
 * consulted here. This is the Learner Model's evidence read for ADR-0015's
 * Practiced → Demonstrated gate — the Transfer Test feature reports through
 * `recordTransferTestOutcome` and never reaches into `attempts` itself.
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
 * recorded for (issue #17) — the batched evidence read behind
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
    .selectDistinct({ conceptId: transferTestExercises.conceptId })
    .from(transferTestExercises)
    .innerJoin(
      attempts,
      and(
        eq(attempts.exerciseId, transferTestExercises.exerciseId),
        eq(attempts.learnerId, transferTestExercises.learnerId),
      ),
    )
    .where(
      and(
        eq(transferTestExercises.learnerId, learnerId),
        inArray(transferTestExercises.conceptId, conceptIds),
        eq(attempts.outcome, 'pass'),
      ),
    )

  return rows.map((row) => row.conceptId)
}
