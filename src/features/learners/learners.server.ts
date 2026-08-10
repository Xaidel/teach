import { db } from '#/db/client.server'
import { learners } from '#/db/schema'

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
