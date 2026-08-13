import { inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db/client.server'
import { concepts, preFlightAttempts } from '#/db/schema'

import { PRE_FLIGHT_RECENCY_WINDOW_DAYS } from './exercise-generation.schema'
import type { PreFlightAttemptAggregate } from './exercise-generation.schema'
import { getPreFlightAttemptAggregates } from './pre-flight-attempt-aggregates.server'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()

const FIXTURE_CONCEPT_IDS = [
  '44444444-4444-7444-8444-444444444444',
  '55555555-5555-7555-8555-555555555555',
]

function fixtureConceptId(offset: number): string {
  const id = FIXTURE_CONCEPT_IDS[offset]
  if (!id) {
    throw new Error('expected the fixture concept ids')
  }
  return id
}

function byConceptId(
  aggregates: PreFlightAttemptAggregate[],
): Map<string, PreFlightAttemptAggregate> {
  return new Map(
    aggregates.map((aggregate) => [aggregate.conceptId, aggregate]),
  )
}

type AttemptRowInsert = Omit<
  typeof preFlightAttempts.$inferInsert,
  'createdAt'
> & { createdAt?: Date | SQL }

/** One Pre-Flight attempt fixture row; `createdAt` defaults to now. */
function attemptRow(input: {
  conceptId: string
  attemptNumber: number
  passed: boolean
  createdAt?: Date | SQL
}): AttemptRowInsert {
  const row: AttemptRowInsert = {
    conceptId: input.conceptId,
    attemptNumber: input.attemptNumber,
    passed: input.passed,
    diagnostics: {
      checks: [],
      referenceResult: { passed: input.passed, tests: [] },
      brokenResult: { passed: false, tests: [] },
    },
  }
  if (input.createdAt) {
    row.createdAt = input.createdAt
  }
  return row
}

beforeAll(async () => {
  await db.insert(concepts).values([
    {
      id: FIXTURE_CONCEPT_IDS[0],
      language: 'rust',
      slug: 'test.rust.attempt-a',
      difficulty: 2,
    },
    {
      id: FIXTURE_CONCEPT_IDS[1],
      language: 'rust',
      slug: 'test.rust.attempt-b',
      difficulty: 2,
    },
  ])
})

afterEach(async () => {
  await db
    .delete(preFlightAttempts)
    .where(inArray(preFlightAttempts.conceptId, FIXTURE_CONCEPT_IDS))
})

afterAll(async () => {
  await db.delete(concepts).where(inArray(concepts.id, FIXTURE_CONCEPT_IDS))
})

describe.skipIf(!dbUp)('pre-flight attempt aggregates against Postgres', () => {
  it('aggregates total and failed attempts per concept (SPEC story 35)', async () => {
    const conceptA = fixtureConceptId(0)
    const conceptB = fixtureConceptId(1)
    await db
      .insert(preFlightAttempts)
      .values([
        attemptRow({ conceptId: conceptA, attemptNumber: 1, passed: false }),
        attemptRow({ conceptId: conceptA, attemptNumber: 2, passed: false }),
        attemptRow({ conceptId: conceptA, attemptNumber: 3, passed: true }),
        attemptRow({ conceptId: conceptB, attemptNumber: 1, passed: true }),
      ])

    const aggregates = await getPreFlightAttemptAggregates()
    const byConcept = byConceptId(aggregates)

    expect(byConcept.get(conceptA)).toEqual({
      conceptId: conceptA,
      totalAttempts: 3,
      failedAttempts: 2,
    })
    expect(byConcept.get(conceptB)).toEqual({
      conceptId: conceptB,
      totalAttempts: 1,
      failedAttempts: 0,
    })
  })
  it('ignores attempts outside the recency window (issue #103)', async () => {
    const conceptA = fixtureConceptId(0)
    const conceptB = fixtureConceptId(1)
    const staleCutoff = new Date(
      Date.now() - 2 * PRE_FLIGHT_RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
    await db.insert(preFlightAttempts).values([
      attemptRow({
        conceptId: conceptA,
        attemptNumber: 1,
        passed: false,
        createdAt: staleCutoff,
      }),
      attemptRow({
        conceptId: conceptA,
        attemptNumber: 2,
        passed: false,
        createdAt: staleCutoff,
      }),
      attemptRow({ conceptId: conceptA, attemptNumber: 3, passed: true }),
      attemptRow({ conceptId: conceptA, attemptNumber: 4, passed: true }),
      attemptRow({
        conceptId: conceptB,
        attemptNumber: 1,
        passed: false,
        createdAt: staleCutoff,
      }),
    ])

    const aggregates = await getPreFlightAttemptAggregates()
    const byConcept = byConceptId(aggregates)

    expect(byConcept.get(conceptA)).toEqual({
      conceptId: conceptA,
      totalAttempts: 2,
      failedAttempts: 0,
    })
    expect(byConcept.get(conceptB)).toBeUndefined()
  })

  it('includes a row exactly at the recency boundary and excludes one microsecond past it (issue #106)', async () => {
    const conceptA = fixtureConceptId(0)
    const conceptB = fixtureConceptId(1)

    await db.transaction(async (tx) => {
      await tx.insert(preFlightAttempts).values([
        attemptRow({
          conceptId: conceptA,
          attemptNumber: 1,
          passed: false,
          createdAt: sql`now() - make_interval(days => ${PRE_FLIGHT_RECENCY_WINDOW_DAYS})`,
        }),
        attemptRow({
          conceptId: conceptA,
          attemptNumber: 2,
          passed: false,
          createdAt: sql`now() - make_interval(days => ${PRE_FLIGHT_RECENCY_WINDOW_DAYS}) - interval '1 microsecond'`,
        }),
        attemptRow({
          conceptId: conceptB,
          attemptNumber: 1,
          passed: true,
          createdAt: sql`now() - make_interval(days => ${PRE_FLIGHT_RECENCY_WINDOW_DAYS})`,
        }),
      ])

      const aggregates = await getPreFlightAttemptAggregates(tx)
      const byConcept = byConceptId(aggregates)

      expect(byConcept.get(conceptA)).toEqual({
        conceptId: conceptA,
        totalAttempts: 1,
        failedAttempts: 1,
      })
      expect(byConcept.get(conceptB)).toEqual({
        conceptId: conceptB,
        totalAttempts: 1,
        failedAttempts: 0,
      })
    })
  })

  it('omits concepts with no Pre-Flight attempts', async () => {
    const aggregates = await getPreFlightAttemptAggregates()

    const byConcept = byConceptId(aggregates)
    const conceptA = fixtureConceptId(0)
    const conceptB = fixtureConceptId(1)
    expect(byConcept.get(conceptA)).toBeUndefined()
    expect(byConcept.get(conceptB)).toBeUndefined()
  })
})
