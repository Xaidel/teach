import { sql } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { preFlightAttempts } from '#/db/schema'

import { PRE_FLIGHT_RECENCY_WINDOW_DAYS } from './exercise-generation.schema'
import type { PreFlightAttemptAggregate } from './exercise-generation.schema'

/**
 * Aggregates every concept's Pre-Flight attempt history into one row per
 * concept (ADR-0010, SPEC story 35): total runs and failed runs within the
 * recency window (PRE_FLIGHT_RECENCY_WINDOW_DAYS). The aggregation is a
 * plain `GROUP BY concept_id` — the shape ADR-0010 chose this table for —
 * and feeds the repeated-failure quality signal surfaced on the generation
 * card.
 */
export async function getPreFlightAttemptAggregates(
  executor: Pick<typeof db, 'select'> = db,
): Promise<PreFlightAttemptAggregate[]> {
  const rows = await executor
    .select({
      conceptId: preFlightAttempts.conceptId,
      totalAttempts: sql<number>`count(*)::int`,
      failedAttempts: sql<number>`count(*) filter (where ${preFlightAttempts.passed} = false)::int`,
    })
    .from(preFlightAttempts)
    .where(
      sql`${preFlightAttempts.createdAt} >= now() - make_interval(days => ${PRE_FLIGHT_RECENCY_WINDOW_DAYS})`,
    )
    .groupBy(preFlightAttempts.conceptId)
  return rows
}
