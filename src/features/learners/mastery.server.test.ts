import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

// The Transfer Test seam mock (frozen at false, pending #17) is gone: issue
// #17 lands the real `hasPassedTransferTest` implementation this suite
// exercises directly below (the "Transfer Test evidence" describe block),
// so the ADR-0015 gate's positive branch is now reachable through real
// data instead of a mocked seam.

import { db } from '#/db/client.server'
import {
  attempts,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  transferTestExercises,
} from '#/db/schema'

import { getCurrentLearnerId } from './learners.server'
import {
  advanceMastery,
  getExerciseConceptIds,
  getMasteryStates,
  getPassedExplanationAssessmentConceptIds,
  getPassedTransferTestConceptIds,
  getRecurringMistakeEvidence,
  hasPassedExplanationAssessment,
  hasPassedTransferTest,
  promoteToDemonstrated,
  recordAttemptOutcome,
  recordExplanationAssessmentOutcome,
  recordTransferTestOutcome,
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

  describe('getRecurringMistakeEvidence', () => {
    let exerciseId: string
    let bareExerciseId: string

    beforeAll(async () => {
      const [exercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-mastery-server-recurring',
          language: 'rust',
          title: 'Recurring-mistake fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!exercise) throw new Error('expected a persisted exercise')
      exerciseId = exercise.id

      await db.insert(exerciseConcepts).values({ exerciseId, conceptId })

      const [bareExercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-mastery-server-recurring-bare',
          language: 'rust',
          title: 'Recurring-mistake bare fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!bareExercise) throw new Error('expected a persisted exercise')
      bareExerciseId = bareExercise.id
    })

    afterAll(async () => {
      await db.delete(attempts).where(eq(attempts.exerciseId, exerciseId))
      await db.delete(attempts).where(eq(attempts.exerciseId, bareExerciseId))
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, exerciseId))
      await db.delete(exercises).where(eq(exercises.id, exerciseId))
      await db.delete(exercises).where(eq(exercises.id, bareExerciseId))
    })

    afterEach(async () => {
      // Scoped to this suite's own exercises (issue #115): a learner-scoped
      // delete would race the concurrent exercise suites' rows for the same
      // seeded learner.
      await db
        .delete(attempts)
        .where(inArray(attempts.exerciseId, [exerciseId, bareExerciseId]))
    })

    it('reports concepts failed at least twice, sorted by count', async () => {
      await db.insert(attempts).values([
        {
          learnerId,
          exerciseId,
          code: 'attempt-1',
          outcome: 'fail',
          timeToSolution: 60,
        },
        {
          learnerId,
          exerciseId,
          code: 'attempt-2',
          outcome: 'fail',
          timeToSolution: 30,
        },
        {
          learnerId,
          exerciseId,
          code: 'attempt-3',
          outcome: 'pass',
          timeToSolution: 120,
        },
      ])

      const evidence = await getRecurringMistakeEvidence(learnerId)
      expect(evidence).toHaveLength(1)
      expect(evidence[0]).toMatchObject({
        conceptId,
        failedAttemptCount: 2,
      })
    })

    it('excludes concepts with fewer than two failed attempts', async () => {
      await db.insert(attempts).values({
        learnerId,
        exerciseId,
        code: 'single-failure',
        outcome: 'fail',
        timeToSolution: 45,
      })

      await expect(getRecurringMistakeEvidence(learnerId)).resolves.toEqual([])
    })

    it('excludes attempts on exercises with no concept rows', async () => {
      await db.insert(attempts).values([
        {
          learnerId,
          exerciseId: bareExerciseId,
          code: 'bare-1',
          outcome: 'fail',
          timeToSolution: 10,
        },
        {
          learnerId,
          exerciseId: bareExerciseId,
          code: 'bare-2',
          outcome: 'fail',
          timeToSolution: 10,
        },
      ])

      await expect(getRecurringMistakeEvidence(learnerId)).resolves.toEqual([])
    })

    it('counts each failed attempt once per joined concept row on a multi-concept exercise', async () => {
      const [secondConcept] = await db
        .insert(concepts)
        .values({
          language: 'rust',
          slug: 'test.mastery-server-recurring-second',
          difficulty: 1,
        })
        .returning()
      if (!secondConcept) throw new Error('expected a persisted concept')

      const [multiExercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-mastery-server-recurring-multi',
          language: 'rust',
          title: 'Recurring-mistake multi-concept fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!multiExercise) throw new Error('expected a persisted exercise')

      await db.insert(exerciseConcepts).values([
        { exerciseId: multiExercise.id, conceptId },
        { exerciseId: multiExercise.id, conceptId: secondConcept.id },
      ])

      await db.insert(attempts).values([
        {
          learnerId,
          exerciseId: multiExercise.id,
          code: 'multi-1',
          outcome: 'fail',
          timeToSolution: 20,
        },
        {
          learnerId,
          exerciseId: multiExercise.id,
          code: 'multi-2',
          outcome: 'fail',
          timeToSolution: 15,
        },
      ])

      const evidence = await getRecurringMistakeEvidence(learnerId)
      // The join counts each failed attempt once per concept row, so the
      // two attempts land on both concepts — documented in ADR-0025.
      expect(evidence).toHaveLength(2)
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conceptId,
            failedAttemptCount: 2,
          }),
          expect.objectContaining({
            conceptId: secondConcept.id,
            failedAttemptCount: 2,
          }),
        ]),
      )

      await db.delete(attempts).where(eq(attempts.exerciseId, multiExercise.id))
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, multiExercise.id))
      await db.delete(exercises).where(eq(exercises.id, multiExercise.id))
      await db.delete(concepts).where(eq(concepts.id, secondConcept.id))
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

    it('promotes to Demonstrated when both signals pass', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')
      await insertExplainAttempt(explainExerciseId, 0.8)

      const [transferExercise] = await db
        .insert(exercises)
        .values({
          slug: `test-mastery-server-transfer-${String(Date.now())}`,
          language: 'rust',
          title: 'Transfer Test fixture',
          prompt: 'p',
          starterCode: 's',
          mode: 'debug',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!transferExercise) throw new Error('expected a persisted exercise')
      await db
        .insert(exerciseConcepts)
        .values({ exerciseId: transferExercise.id, conceptId })
      await db.insert(transferTestExercises).values({
        learnerId,
        conceptId,
        exerciseId: transferExercise.id,
      })
      await db.insert(attempts).values({
        learnerId,
        exerciseId: transferExercise.id,
        code: 'fixture solution',
        outcome: 'pass',
        timeToSolution: 0,
      })

      try {
        await recordExplanationAssessmentOutcome({
          learnerId,
          conceptId,
          passed: true,
        })

        await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual(
          {
            [conceptId]: 'demonstrated',
          },
        )
      } finally {
        await db
          .delete(attempts)
          .where(eq(attempts.exerciseId, transferExercise.id))
        await db
          .delete(transferTestExercises)
          .where(eq(transferTestExercises.exerciseId, transferExercise.id))
        await db
          .delete(exerciseConcepts)
          .where(eq(exerciseConcepts.exerciseId, transferExercise.id))
        await db.delete(exercises).where(eq(exercises.id, transferExercise.id))
      }
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

  describe('Transfer Test evidence (issue #17)', () => {
    let transferExerciseId: string

    /** Persists a debug-mode exercise targeting the fixture concept and
     * registers it as the fixture learner's Transfer Test for that concept
     * (mirrors `registerTransferTestExercise`'s pointer, ADR-0010). */
    async function insertTransferTestExercise(): Promise<string> {
      const [exercise] = await db
        .insert(exercises)
        .values({
          slug: `test-mastery-server-transfer-${String(Date.now())}-${String(Math.random())}`,
          language: 'rust',
          title: 'Transfer Test fixture',
          prompt: 'p',
          starterCode: 's',
          mode: 'debug',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!exercise) throw new Error('expected a persisted exercise')
      await db
        .insert(exerciseConcepts)
        .values({ exerciseId: exercise.id, conceptId })
      await db
        .insert(transferTestExercises)
        .values({ learnerId, conceptId, exerciseId: exercise.id })
      return exercise.id
    }

    beforeAll(async () => {
      transferExerciseId = await insertTransferTestExercise()
    })

    afterAll(async () => {
      await db
        .delete(attempts)
        .where(eq(attempts.exerciseId, transferExerciseId))
      await db
        .delete(transferTestExercises)
        .where(eq(transferTestExercises.exerciseId, transferExerciseId))
      await db
        .delete(exerciseConcepts)
        .where(eq(exerciseConcepts.exerciseId, transferExerciseId))
      await db.delete(exercises).where(eq(exercises.id, transferExerciseId))
    })

    afterEach(async () => {
      await db
        .delete(attempts)
        .where(eq(attempts.exerciseId, transferExerciseId))
    })

    it('reports no passed test before any attempt on the registered exercise', async () => {
      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        false,
      )
      await expect(
        getPassedTransferTestConceptIds(learnerId, [conceptId]),
      ).resolves.toEqual([])
    })

    it('ignores a failed attempt on the registered exercise as evidence', async () => {
      await db.insert(attempts).values({
        learnerId,
        exerciseId: transferExerciseId,
        code: 'fixture solution',
        outcome: 'fail',
        timeToSolution: 0,
      })

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        false,
      )
    })

    it('reports a passed attempt on the registered exercise as evidence', async () => {
      await db.insert(attempts).values({
        learnerId,
        exerciseId: transferExerciseId,
        code: 'fixture solution',
        outcome: 'pass',
        timeToSolution: 0,
      })

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        true,
      )
      await expect(
        getPassedTransferTestConceptIds(learnerId, [conceptId]),
      ).resolves.toEqual([conceptId])
    })

    it('ignores a passed attempt on an unrelated exercise as evidence', async () => {
      const [otherExercise] = await db
        .insert(exercises)
        .values({
          slug: `test-mastery-server-transfer-unrelated-${String(Date.now())}`,
          language: 'rust',
          title: 'Unrelated debug-mode fixture',
          prompt: 'p',
          starterCode: 's',
          mode: 'debug',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!otherExercise) throw new Error('expected a persisted exercise')
      await db
        .insert(exerciseConcepts)
        .values({ exerciseId: otherExercise.id, conceptId })

      try {
        await db.insert(attempts).values({
          learnerId,
          exerciseId: otherExercise.id,
          code: 'fixture solution',
          outcome: 'pass',
          timeToSolution: 0,
        })

        await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
          false,
        )
      } finally {
        await db
          .delete(attempts)
          .where(eq(attempts.exerciseId, otherExercise.id))
        await db
          .delete(exerciseConcepts)
          .where(eq(exerciseConcepts.exerciseId, otherExercise.id))
        await db.delete(exercises).where(eq(exercises.id, otherExercise.id))
      }
    })

    it('recordTransferTestOutcome is a no-op for a failed attempt', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')

      await recordTransferTestOutcome({ learnerId, conceptId, passed: false })

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'practiced',
      })
    })

    it('never promotes a concept with a TT pass alone — Explanation Assessment is also required', async () => {
      await advanceMastery(learnerId, [conceptId], 'practiced')

      await recordTransferTestOutcome({ learnerId, conceptId, passed: true })

      await expect(getMasteryStates(learnerId, [conceptId])).resolves.toEqual({
        [conceptId]: 'practiced',
      })
    })

    it('recordAttemptOutcome fires Transfer Test evidence when the submitted exercise is the registered one (general practice path)', async () => {
      // Mirrors `submitExercise`: the attempts row is always persisted
      // before `recordAttemptOutcome` is called with its derived booleans.
      await db.insert(attempts).values({
        learnerId,
        exerciseId: transferExerciseId,
        code: 'fixture solution',
        outcome: 'pass',
        timeToSolution: 0,
      })

      await recordAttemptOutcome(learnerId, transferExerciseId, true, true)

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        true,
      )
    })

    it('recordAttemptOutcome does not require Stage 2 to record Transfer Test evidence', async () => {
      await db.insert(attempts).values({
        learnerId,
        exerciseId: transferExerciseId,
        code: 'fixture solution',
        outcome: 'pass',
        timeToSolution: 0,
      })

      await recordAttemptOutcome(learnerId, transferExerciseId, true, false)

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        true,
      )
    })

    it('recordAttemptOutcome does not record Transfer Test evidence on a Stage 1 failure', async () => {
      await db.insert(attempts).values({
        learnerId,
        exerciseId: transferExerciseId,
        code: 'fixture solution',
        outcome: 'fail',
        timeToSolution: 0,
      })

      await recordAttemptOutcome(learnerId, transferExerciseId, false, false)

      await expect(hasPassedTransferTest(learnerId, conceptId)).resolves.toBe(
        false,
      )
    })
  })
})
