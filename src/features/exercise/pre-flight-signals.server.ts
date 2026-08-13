import { sql } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { preFlightAttempts } from '#/db/schema'

import type { PreFlightFailureSignal } from './exercise-generation.schema'

/**
 * Aggregates every concept's Pre-Flight attempt history into one row per
 * concept (ADR-0010, SPEC story 35): total runs and failed runs. The
 * aggregation is a plain `GROUP BY concept_id` — the shape ADR-0010 chose
 * this table for — and feeds the repeated-failure quality signal surfaced
 * on the generation card.
 */
export async function getPreFlightFailureSignals(): Promise<
  PreFlightFailureSignal[]
> {
  const rows = await db
    .select({
      conceptId: preFlightAttempts.conceptId,
      totalAttempts: sql<number>`count(*)::int`,
      failedAttempts: sql<number>`count(*) filter (where ${preFlightAttempts.passed} = false)::int`,
    })
    .from(preFlightAttempts)
    .groupBy(preFlightAttempts.conceptId)
  return rows
}
