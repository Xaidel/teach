import { and, eq, sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// The Transfer Test seam is deliberately frozen at false until #17 lands;
// the ADR-0015 gate's positive branch is unreachable through real data, so
// it is exercised here by mocking the seam module true for one call
// (review P6). Mocking the seam module, not mastery.server, is what lets
// `promoteToDemonstrated`'s internal call resolve to the mock.
vi.mock('./transfer-test.server', () => ({
  hasPassedTransferTest: vi.fn().mockReturnValue(false),
}))

import { db } from '#/db/client.server'
import {
  attempts,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
} from '#/db/schema'

import { getCurrentLearnerId } from './learners.server'
import { hasPassedTransferTest } from './transfer-test.server'
import {
  advanceMastery,
  getExerciseConceptIds,
  getMasteryStates,
  getPassedExplanationAssessmentConceptIds,
  hasPassedExplanationAssessment,
  promoteToDemonstrated,
  recordAttemptOutcome,
  recordExplanationAssessmentOutcome,
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
    // ADR-0014: exactly one learner row must hold at all times — the seeded
    // v1 row. This suite must not insert a fixture learner of its own: a
    // second row would transiently break getCurrentLearnerId's exactly-one
    // guard for every DB suite running concurrently in the same process
    // (issue #115). All fixture state is scoped to this suite's own
    // concept instead: mastery rows are written for (learnerId, conceptId)
    // below and deleted by that same key in `afterEach`/`afterAll`, so a
    // concurrent suite's rows are never touched.
    learnerId = await getCurrentLearnerId()

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
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, conceptId),
        ),
      )
    await db.delete(concepts).where(eq(concepts.id, conceptId))
  })

  afterEach(async () => {
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, conceptId),
        ),
      )
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

  describe('recordAttemptOutcome', () => {
    let exerciseId: string

    beforeAll(async () => {
      const [exercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-mastery-server-record-attempt-outcome',
          language: 'rust',
          title: 'recordAttemptOutcome fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!exercise) throw new Error('expected a persisted exercise')
      exerciseId = exercise.id

      await db.insert(exerciseConcepts).values({ exerciseId, conceptId })
    })

    afterAll(async () => {
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, exerciseId))
      await db.delete(exercises).where(eq(exercises.id, exerciseId))
    })

    it('advances to Introduced on a failed attempt', async () => {
      await recordAttemptOutcome(learnerId, exerciseId, false, false)

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'introduced',
      })
    })

    it('advances to Introduced only when Stage 1 passes but Stage 2 does not', async () => {
      await recordAttemptOutcome(learnerId, exerciseId, true, false)

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'introduced',
      })
    })

    it('advances to Practiced when Stage 1 and Stage 2 both pass', async () => {
      await recordAttemptOutcome(learnerId, exerciseId, true, true)

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'practiced',
      })
    })

    it('is a no-op for an exercise with no exercise_concepts row', async () => {
      const [bareExercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-mastery-server-record-attempt-outcome-bare',
          language: 'rust',
          title: 'recordAttemptOutcome bare fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!bareExercise) throw new Error('expected a persisted exercise')

      try {
        await recordAttemptOutcome(learnerId, bareExercise.id, true, true)

        await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual(
          { [conceptId]: 'unknown' },
        )
      } finally {
        await db.delete(exercises).where(eq(exercises.id, bareExercise.id))
      }
    })
  })

  describe('Explanation Assessment evidence (issue #16)', () => {
    let explainExerciseId: string

    /** Persists an explain-mode exercise targeting the fixture concept. */
    async function insertExplainExercise(): Promise<string> {
      const [exercise] = await db
        .insert(exercises)
        .values({
          slug: `test-mastery-server-explain-${String(Date.now())}`,
          language: 'rust',
          title: 'Explain fixture',
          prompt: 'Explain this concept in your own words.',
          starterCode: '',
          mode: 'explain',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!exercise) throw new Error('expected a persisted exercise')
      await db
        .insert(exerciseConcepts)
        .values({ exerciseId: exercise.id, conceptId })
      return exercise.id
    }

    /** Persists an explain-mode attempt with the given accuracy score. */
    async function insertExplainAttempt(
      exerciseId: string,
      accuracyScore: number,
    ): Promise<void> {
      await db.insert(attempts).values({
        learnerId,
        exerciseId,
        code: 'fixture explanation',
        timeToSolution: 0,
        explanationAssessment: {
          accuracyScore,
          analysis: { missing: [], incorrect: [], conflated: [] },
        },
      })
    }

    beforeAll(async () => {
      explainExerciseId = await insertExplainExercise()
    })

    afterAll(async () => {
      await db
        .delete(attempts)
        .where(eq(attempts.exerciseId, explainExerciseId))
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, explainExerciseId))
      await db.delete(exercises).where(eq(exercises.id, explainExerciseId))
    })

    afterEach(async () => {
      await db
        .delete(attempts)
        .where(eq(attempts.exerciseId, explainExerciseId))
      // The seam's default is false (no TT evidence until #17 lands); a
      // test that queues a one-shot true must never leak it to its sibling.
      vi.mocked(hasPassedTransferTest).mockReset()
      vi.mocked(hasPassedTransferTest).mockReturnValue(false)
    })

    it('reports no passed assessment before any explain attempt', async () => {
      await expect(
        hasPassedExplanationAssessment(learnerId, conceptId),
      ).resolves.toBe(false)
      await expect(
        getPassedExplanationAssessmentConceptIds(learnerId, [conceptId]),
      ).resolves.toEqual([])
    })

    it('ignores below-threshold explain attempts as evidence', async () => {
      await insertExplainAttempt(explainExerciseId, 0.4)

      await expect(
        hasPassedExplanationAssessment(learnerId, conceptId),
      ).resolves.toBe(false)
    })

    it('reports an at-or-above-threshold explain attempt as evidence', async () => {
      await insertExplainAttempt(explainExerciseId, 0.8)

      await expect(
        hasPassedExplanationAssessment(learnerId, conceptId),
      ).resolves.toBe(true)
      await expect(
        getPassedExplanationAssessmentConceptIds(learnerId, [conceptId]),
      ).resolves.toEqual([conceptId])
    })

    it('ignores explain attempts that carry an outcome but no payload score', async () => {
      await db.insert(attempts).values({
        learnerId,
        exerciseId: explainExerciseId,
        code: 'fixture explanation',
        outcome: 'pass',
        timeToSolution: 0,
      })

      await expect(
        hasPassedExplanationAssessment(learnerId, conceptId),
      ).resolves.toBe(false)
    })

    it('promotes to Demonstrated when both signals pass (TT seam mocked true)', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      await insertExplainAttempt(explainExerciseId, 0.8)
      vi.mocked(hasPassedTransferTest).mockReturnValueOnce(true)

      await recordExplanationAssessmentOutcome({
        learnerId,
        conceptId,
        passed: true,
      })

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'demonstrated',
      })
    })
  })

  describe('promoteToDemonstrated / recordExplanationAssessmentOutcome (ADR-0015 gate)', () => {
    it('never promotes a concept with an EA pass alone — Transfer Test is also required', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')

      await recordExplanationAssessmentOutcome({
        learnerId,
        conceptId,
        passed: true,
      })

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'practiced',
      })
    })

    it('promoteToDemonstrated leaves an already-Demonstrated concept untouched', async () => {
      await advanceMastery(learnerId, [conceptId], 'demonstrated')

      const state = await promoteToDemonstrated({ learnerId, conceptId })

      expect(state).toBe('demonstrated')
      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'demonstrated',
      })
    })

    it('never promotes from below Practiced', async () => {
      await advanceMastery(learnerId, [conceptId], 'introduced')

      const state = await promoteToDemonstrated({ learnerId, conceptId })

      expect(state).toBe('introduced')
    })

    it('recordExplanationAssessmentOutcome is a no-op for a failed attempt', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')

      await recordExplanationAssessmentOutcome({
        learnerId,
        conceptId,
        passed: false,
      })

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'practiced',
      })
    })
  })
})
