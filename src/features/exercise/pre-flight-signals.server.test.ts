import { inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db/client.server'
import { concepts, preFlightAttempts } from '#/db/schema'

import { getPreFlightFailureSignals } from './pre-flight-signals.server'

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

beforeAll(async () => {
  await db.insert(concepts).values([
    {
      id: FIXTURE_CONCEPT_IDS[0],
      language: 'rust',
      slug: 'test.rust.signal-a',
      difficulty: 2,
    },
    {
      id: FIXTURE_CONCEPT_IDS[1],
      language: 'rust',
      slug: 'test.rust.signal-b',
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

describe.skipIf(!dbUp)('pre-flight failure signals against Postgres', () => {
  it('aggregates total and failed attempts per concept (SPEC story 35)', async () => {
    const [conceptA] = FIXTURE_CONCEPT_IDS
    const [conceptB] = FIXTURE_CONCEPT_IDS.slice(1)
    if (!conceptA || !conceptB) {
      throw new Error('expected the fixture concept ids')
    }
    await db.insert(preFlightAttempts).values([
      {
        conceptId: conceptA,
        attemptNumber: 1,
        passed: false,
        diagnostics: {
          checks: [],
          referenceResult: { passed: false, tests: [] },
          brokenResult: { passed: false, tests: [] },
        },
      },
      {
        conceptId: conceptA,
        attemptNumber: 2,
        passed: false,
        diagnostics: {
          checks: [],
          referenceResult: { passed: false, tests: [] },
          brokenResult: { passed: false, tests: [] },
        },
      },
      {
        conceptId: conceptA,
        attemptNumber: 3,
        passed: true,
        diagnostics: {
          checks: [],
          referenceResult: { passed: true, tests: [] },
          brokenResult: { passed: false, tests: [] },
        },
      },
      {
        conceptId: conceptB,
        attemptNumber: 1,
        passed: true,
        diagnostics: {
          checks: [],
          referenceResult: { passed: true, tests: [] },
          brokenResult: { passed: false, tests: [] },
        },
      },
    ])

    const signals = await getPreFlightFailureSignals()
    const byConceptId = new Map(
      signals.map((signal) => [signal.conceptId, signal]),
    )

    expect(byConceptId.get(conceptA)).toEqual({
      conceptId: conceptA,
      totalAttempts: 3,
      failedAttempts: 2,
    })
    expect(byConceptId.get(conceptB)).toEqual({
      conceptId: conceptB,
      totalAttempts: 1,
      failedAttempts: 0,
    })
  })

  it('omits concepts with no Pre-Flight attempts', async () => {
    const signals = await getPreFlightFailureSignals()

    const byConceptId = new Map(
      signals.map((signal) => [signal.conceptId, signal]),
    )
    const [conceptA] = FIXTURE_CONCEPT_IDS
    const [conceptB] = FIXTURE_CONCEPT_IDS.slice(1)
    if (!conceptA || !conceptB) {
      throw new Error('expected the fixture concept ids')
    }
    expect(byConceptId.get(conceptA)).toBeUndefined()
    expect(byConceptId.get(conceptB)).toBeUndefined()
  })
})
