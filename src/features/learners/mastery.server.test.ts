import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db/client.server'
import {
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  learners,
} from '#/db/schema'

import {
  advanceMastery,
  getExerciseConceptIds,
  getMasteryStates,
} from './mastery.server'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()

describe.skipIf(!dbUp)('mastery.server', () => {
  let learnerId: string
  let conceptId: string

  beforeAll(async () => {
    // A fixture learner of its own, not the seeded v1 row: getCurrentLearnerId
    // (ADR-0014) hard-throws on more than one `learners` row, so this suite
    // must not leave an extra row behind for other suites to trip over —
    // removed in `afterAll` below.
    const [learner] = await db.insert(learners).values({}).returning()
    if (!learner) throw new Error('expected a persisted learner')
    learnerId = learner.id

    const [concept] = await db
      .insert(concepts)
      .values({
        language: 'rust',
        slug: 'test.mastery-server-fixture',
        difficulty: 1,
      })
      .returning()
    if (!concept) throw new Error('expected a persisted concept')
    conceptId = concept.id
  })

  afterAll(async () => {
    await db
      .delete(learnerConceptMastery)
      .where(eq(learnerConceptMastery.learnerId, learnerId))
    await db.delete(concepts).where(eq(concepts.id, conceptId))
    await db.delete(learners).where(eq(learners.id, learnerId))
  })

  afterEach(async () => {
    await db
      .delete(learnerConceptMastery)
      .where(eq(learnerConceptMastery.learnerId, learnerId))
  })

  it('has no row before any attempt — Unknown is the implicit state', async () => {
    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'unknown',
    })
  })

  it('creates an Introduced row on first advance', async () => {
    await advanceMastery(learnerId, [conceptId], 'introduced')

    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'introduced',
    })
  })

  it('advances Introduced to Practiced', async () => {
    await advanceMastery(learnerId, [conceptId], 'introduced')
    await advanceMastery(learnerId, [conceptId], 'practiced')

    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'practiced',
    })
  })

  it('never regresses an already-advanced state', async () => {
    await advanceMastery(learnerId, [conceptId], 'practiced')
    await advanceMastery(learnerId, [conceptId], 'introduced')

    await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
      [conceptId]: 'practiced',
    })
  })

  it('is a no-op for an empty concept list', async () => {
    await expect(
      advanceMastery(learnerId, [], 'practiced'),
    ).resolves.toBeUndefined()
  })

  it('resolves the concepts an exercise targets via exercise_concepts', async () => {
    const [exercise] = await db
      .insert(exercises)
      .values({
        slug: 'test-mastery-server-exercise',
        language: 'rust',
        title: 'Mastery fixture',
        prompt: 'p',
        starterCode: 's',
        difficulty: 1,
        status: 'verified',
      })
      .returning()
    if (!exercise) throw new Error('expected a persisted exercise')

    try {
      await expect(getExerciseConceptIds(exercise.id)).resolves.toEqual([])

      await db
        .insert(exerciseConcepts)
        .values({ exerciseId: exercise.id, conceptId })

      await expect(getExerciseConceptIds(exercise.id)).resolves.toEqual([
        conceptId,
      ])
    } finally {
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, exercise.id))
      await db.delete(exercises).where(eq(exercises.id, exercise.id))
    }
  })
})
