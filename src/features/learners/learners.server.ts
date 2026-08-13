import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { learners } from '#/db/schema'

import type {
  ExplanationPreferences,
  UpdateExplanationPreferencesInput,
} from './learners.schema'

/**
 * Resolves the current learner by querying the learners table (ADR-0014):
 * exactly one seeded row for v1. Throws — never falls back — when the table
 * holds zero or more than one row.
 */
export async function getCurrentLearnerId(): Promise<string> {
  const rows = await db.select({ id: learners.id }).from(learners)

  const first = rows[0]
  if (!first) {
    throw new Error(
      'No learner row found. Run `pnpm run db:seed` to create the v1 learner.',
    )
  }
  if (rows.length > 1) {
    throw new Error(
      `Expected exactly one learner row, found ${String(rows.length)}. The learners table must hold exactly one row for v1.`,
    )
  }

  return first.id
}

/**
 * Resolves one learner's current explanation preferences (issue #12): the
 * depth and optional reference frame that shape how hints and explanations
 * are presented. Exposed as the narrow, named entry point `exercise.server.ts`
 * imports (`arch_docs/dependency-rules.md`'s Feature Dependencies exception;
 * the import is one-way and `learners` never imports back) so hint
 * generation can honor the learner's current setting without reaching into
 * `learners`' internals.
 */
export async function getExplanationPreferences(
  learnerId: string,
): Promise<ExplanationPreferences> {
  const rows = await db
    .select({
      depth: learners.explanationDepth,
      referenceFrame: learners.referenceFrame,
    })
    .from(learners)
    .where(eq(learners.id, learnerId))
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new Error(`No learner row found for id "${learnerId}".`)
  }

  return row
}

/**
 * Changes one learner's explanation preferences (issue #12). Depth and
 * reference frame are independent, partial updates — an omitted field is
 * left unchanged. Returns the resulting preferences so the caller can
 * reflect the persisted state immediately.
 */
export async function updateExplanationPreferences(
  learnerId: string,
  input: UpdateExplanationPreferencesInput,
): Promise<ExplanationPreferences> {
  const patch: Partial<typeof learners.$inferInsert> = {}
  if (input.depth !== undefined) patch.explanationDepth = input.depth
  if (input.referenceFrame !== undefined) {
    patch.referenceFrame = input.referenceFrame
  }

  if (Object.keys(patch).length === 0) {
    return getExplanationPreferences(learnerId)
  }

  const rows = await db
    .update(learners)
    .set(patch)
    .where(eq(learners.id, learnerId))
    .returning({
      depth: learners.explanationDepth,
      referenceFrame: learners.referenceFrame,
    })

  const row = rows[0]
  if (!row) {
    throw new Error(`No learner row found for id "${learnerId}".`)
  }

  return row
}
