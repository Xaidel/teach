import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db/client.server'
import {
  concepts,
  exerciseConcepts,
  exercises,
  transferTestExercises,
} from '#/db/schema'

import { getCurrentLearnerId } from './learners.server'
import {
  findTransferTestConceptForExercise,
  getPassedTransferTestConceptIds,
  getTransferTestExerciseId,
  hasPassedTransferTest,
  markTransferTestExercisePassed,
  registerTransferTestExercise,
} from './transfer-test.server'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()

describe.skipIf(!dbUp)('learners/transfer-test.server', () => {
  let learnerId: string
  let conceptId: string
  let otherConceptId: string
  let exerciseId: string
  let otherExerciseId: string

  beforeAll(async () => {
    // ADR-0014: exactly one learner row must hold at all times — the seeded
    // v1 row. This suite must not insert a fixture learner of its own (issue
    // #115); all fixture state below is scoped to its own concept/exercise
    // rows instead.
    learnerId = await getCurrentLearnerId()

    const [concept] = await db
      .insert(concepts)
      .values({
        language: 'rust',
        slug: 'test.learners-transfer-test-server-fixture',
        difficulty: 1,
      })
      .returning()
    if (!concept) throw new Error('expected a persisted concept')
    conceptId = concept.id

    const [otherConcept] = await db
      .insert(concepts)
      .values({
        language: 'rust',
        slug: 'test.learners-transfer-test-server-fixture-other',
        difficulty: 1,
      })
      .returning()
    if (!otherConcept) throw new Error('expected a persisted concept')
    otherConceptId = otherConcept.id

    const [exercise] = await db
      .insert(exercises)
      .values({
        slug: 'test-learners-transfer-test-server-exercise',
        language: 'rust',
        title: 'Transfer Test pointer fixture',
        prompt: 'p',
        starterCode: 's',
        mode: 'debug',
        difficulty: 1,
        status: 'verified',
      })
      .returning()
    if (!exercise) throw new Error('expected a persisted exercise')
    exerciseId = exercise.id
    await db.insert(exerciseConcepts).values({ exerciseId, conceptId })

    const [otherExercise] = await db
      .insert(exercises)
      .values({
        slug: 'test-learners-transfer-test-server-other-exercise',
        language: 'rust',
        title: 'Unregistered exercise fixture',
        prompt: 'p',
        starterCode: 's',
        mode: 'debug',
        difficulty: 1,
        status: 'verified',
      })
      .returning()
    if (!otherExercise) throw new Error('expected a persisted exercise')
    otherExerciseId = otherExercise.id
  })

  afterAll(async () => {
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, exerciseId))
    await db.delete(exercises).where(eq(exercises.id, exerciseId))
    await db.delete(exercises).where(eq(exercises.id, otherExerciseId))
    await db.delete(concepts).where(eq(concepts.id, conceptId))
    await db.delete(concepts).where(eq(concepts.id, otherConceptId))
  })

  afterEach(async () => {
    await db
      .delete(transferTestExercises)
      .where(eq(transferTestExercises.learnerId, learnerId))
  })

  describe('registerTransferTestExercise / getTransferTestExerciseId', () => {
    it('returns null before any registration', async () => {
      await expect(
        getTransferTestExerciseId({ learnerId, conceptId }),
      ).resolves.toBeNull()
    })

    it('registers an exercise as the learner’s Transfer Test for the concept', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })

      await expect(
        getTransferTestExerciseId({ learnerId, conceptId }),
      ).resolves.toBe(exerciseId)
    })

    it('is a no-op on a second registration for the same (learner, concept) — always the same instance', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })
      await registerTransferTestExercise({
        learnerId,
        conceptId,
        exerciseId: otherExerciseId,
      })

      await expect(
        getTransferTestExerciseId({ learnerId, conceptId }),
      ).resolves.toBe(exerciseId)
    })

    it('keeps registrations independent per concept', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })

      await expect(
        getTransferTestExerciseId({ learnerId, conceptId: otherConceptId }),
      ).resolves.toBeNull()
    })
  })

  describe('findTransferTestConceptForExercise', () => {
    it('returns null for an exercise that is nobody’s registered Transfer Test', async () => {
      await expect(
        findTransferTestConceptForExercise({
          learnerId,
          exerciseId: otherExerciseId,
        }),
      ).resolves.toBeNull()
    })

    it('resolves the registered exercise back to its concept', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })

      await expect(
        findTransferTestConceptForExercise({ learnerId, exerciseId }),
      ).resolves.toBe(conceptId)
    })
  })

  describe('markTransferTestExercisePassed / hasPassedTransferTest', () => {
    it('reports not passed before marking', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        false,
      )
    })

    it('marks the registered instance passed and reports it as evidence', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })

      await markTransferTestExercisePassed({ learnerId, conceptId })

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        true,
      )
      await expect(
        getPassedTransferTestConceptIds(learnerId, [conceptId, otherConceptId]),
      ).resolves.toEqual([conceptId])
    })

    it('is idempotent — marking an already-passed instance again is a no-op', async () => {
      await registerTransferTestExercise({ learnerId, conceptId, exerciseId })
      await markTransferTestExercisePassed({ learnerId, conceptId })

      await expect(
        markTransferTestExercisePassed({ learnerId, conceptId }),
      ).resolves.toBeUndefined()
      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        true,
      )
    })

    it('is a no-op when the learner has no registered Transfer Test for the concept', async () => {
      await expect(
        markTransferTestExercisePassed({
          learnerId,
          conceptId: otherConceptId,
        }),
      ).resolves.toBeUndefined()
      await expect(
        hasPassedTransferTest(learnerId, otherConceptId),
      ).resolves.toBe(false)
    })

    it('getPassedTransferTestConceptIds is empty for an empty concept list', async () => {
      await expect(
        getPassedTransferTestConceptIds(learnerId, []),
      ).resolves.toEqual([])
    })
  })
})
