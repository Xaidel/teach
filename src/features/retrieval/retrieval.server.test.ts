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

import { db } from '#/db/client.server'
import {
  attempts,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  retrievalQueue,
  retrievalReviewExercises,
} from '#/db/schema'
import {
  advanceMastery,
  getMasteryStates,
  recordAttemptOutcome,
  recordExplanationAssessmentOutcome,
} from '#/features/learners/mastery.server'
import { getCurrentLearnerId } from '#/features/learners/learners.server'
import {
  RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
  RETRIEVAL_SCHEDULE_DAYS,
} from '#/lib/retrieval-schedule'

// The generation fallback is the only AI seam this suite touches; every
// other path (reuse a verified exercise, queue upserts, review semantics)
// is deterministic and DB-only.
vi.mock('#/features/exercise/exercise-generation.server', () => ({
  generateExerciseForConcept: vi.fn(),
}))

import { generateExerciseForConcept } from '#/features/exercise/exercise-generation.server'

import { RetrievalError } from './retrieval.schema'
import { getRetrievalQueue, startRetrievalReview } from './retrieval.server'

const CONCEPT_SLUG = 'test.retrieval.target'
const OTHER_CONCEPT_SLUG = 'test.retrieval.second'
const EXERCISE_SLUG = 'test-retrieval-exercise'

const generateExerciseMock = vi.mocked(generateExerciseForConcept)

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()

describe.skipIf(!dbUp)('retrieval.server', () => {
  let learnerId: string
  let conceptId: string
  let otherConceptId: string

  beforeAll(async () => {
    // ADR-0014: exactly one learner row must hold at all times — the seeded
    // v1 row. This suite must not insert a fixture learner of its own
    // (issue #115); all fixture state is scoped to its own concepts.
    learnerId = await getCurrentLearnerId()

    const [concept] = await db
      .insert(concepts)
      .values({ language: 'rust', slug: CONCEPT_SLUG, difficulty: 2 })
      .returning()
    if (!concept) throw new Error('expected a persisted concept')
    conceptId = concept.id

    const [other] = await db
      .insert(concepts)
      .values({ language: 'rust', slug: OTHER_CONCEPT_SLUG, difficulty: 4 })
      .returning()
    if (!other) throw new Error('expected a persisted concept')
    otherConceptId = other.id
  })

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.id, otherConceptId))
    await db.delete(concepts).where(eq(concepts.id, conceptId))
  })

  afterEach(async () => {
    await db
      .delete(retrievalReviewExercises)
      .where(
        and(
          eq(retrievalReviewExercises.learnerId, learnerId),
          eq(retrievalReviewExercises.conceptId, conceptId),
        ),
      )
    await db
      .delete(retrievalReviewExercises)
      .where(
        and(
          eq(retrievalReviewExercises.learnerId, learnerId),
          eq(retrievalReviewExercises.conceptId, otherConceptId),
        ),
      )
    await db
      .delete(retrievalQueue)
      .where(eq(retrievalQueue.conceptId, conceptId))
    await db
      .delete(retrievalQueue)
      .where(eq(retrievalQueue.conceptId, otherConceptId))
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, conceptId),
        ),
      )
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          eq(learnerConceptMastery.conceptId, otherConceptId),
        ),
      )
    const exerciseRows = await db
      .select({ id: exerciseConcepts.exerciseId })
      .from(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, conceptId))
    const exerciseIds = exerciseRows.map((row) => row.id)
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, conceptId))
    for (const id of exerciseIds) {
      await db.delete(attempts).where(eq(attempts.exerciseId, id))
      await db.delete(exercises).where(eq(exercises.id, id))
    }
    // The generation-fallback fixture is written without an
    // exercise_concepts join (that is the point of the fallback path), so
    // it is cleaned up by slug rather than by join.
    await db
      .delete(exercises)
      .where(eq(exercises.slug, 'test-retrieval-generated'))
    generateExerciseMock.mockReset()
  })

  /** Inserts a verified exercise targeting the fixture concept. */
  async function seedVerifiedExercise(): Promise<string> {
    const [exercise] = await db
      .insert(exercises)
      .values({
        slug: EXERCISE_SLUG,
        language: 'rust',
        title: 'Retrieval fixture exercise',
        prompt: 'p',
        starterCode: 's',
        difficulty: 1,
        status: 'verified',
      })
      .returning()
    if (!exercise) throw new Error('expected a persisted exercise')
    await db.insert(exerciseConcepts).values({
      exerciseId: exercise.id,
      conceptId,
    })
    return exercise.id
  }

  /** Marks the fixture concept's queue row due (backdated `due_at`). */
  async function makeDue(concept = conceptId): Promise<void> {
    await db
      .update(retrievalQueue)
      .set({ dueAt: sql`now() - interval '1 hour'` })
      .where(
        and(
          eq(retrievalQueue.learnerId, learnerId),
          eq(retrievalQueue.conceptId, concept),
        ),
      )
  }

  async function queueRow(
    concept = conceptId,
  ): Promise<{ scheduleStage: number; dueAt: Date; priorityScore: number }> {
    const row = await db.query.retrievalQueue.findFirst({
      where: and(
        eq(retrievalQueue.learnerId, learnerId),
        eq(retrievalQueue.conceptId, concept),
      ),
    })
    if (!row) throw new Error('expected a queue row')
    return {
      scheduleStage: row.scheduleStage,
      dueAt: row.dueAt,
      priorityScore: row.priorityScore,
    }
  }

  describe('upsertRetrievalQueue via recordAttemptOutcome', () => {
    it('creates a stage-0 row due 24h out on the first attempt', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)

      const row = await queueRow()
      expect(row.scheduleStage).toBe(0)
      const expectedMs = (RETRIEVAL_SCHEDULE_DAYS[0] ?? 1) * 24 * 60 * 60 * 1000
      expect(row.dueAt.getTime() - Date.now()).toBeGreaterThan(
        expectedMs - 5_000,
      )
      expect(row.dueAt.getTime() - Date.now()).toBeLessThan(expectedMs + 5_000)
      expect(row.priorityScore).toBeLessThan(
        RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
      )
    })

    it('advances one stage per successful retrieval', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await recordAttemptOutcome(learnerId, exerciseId, true, true)

      const row = await queueRow()
      expect(row.scheduleStage).toBe(1)
    })

    it('caps at the final 60-day stage', async () => {
      const exerciseId = await seedVerifiedExercise()
      for (let i = 0; i < 8; i += 1) {
        await recordAttemptOutcome(learnerId, exerciseId, true, true)
      }

      const row = await queueRow()
      expect(row.scheduleStage).toBe(4)
    })

    it('resets a failed attempt to stage 0 with the remediation boost', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await recordAttemptOutcome(learnerId, exerciseId, false, false)

      const row = await queueRow()
      expect(row.scheduleStage).toBe(0)
      expect(row.priorityScore).toBeGreaterThanOrEqual(
        RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
      )
    })

    it('treats a Stage-1-only pass as a failed retrieval', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await recordAttemptOutcome(learnerId, exerciseId, true, false)

      const row = await queueRow()
      expect(row.scheduleStage).toBe(0)
      expect(row.priorityScore).toBeGreaterThanOrEqual(
        RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
      )
    })

    it('is a no-op for exercises without exercise_concepts rows', async () => {
      const [bare] = await db
        .insert(exercises)
        .values({
          slug: 'test-retrieval-bare',
          language: 'rust',
          title: 'Bare fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!bare) throw new Error('expected a persisted exercise')

      await recordAttemptOutcome(learnerId, bare.id, true, true)

      await expect(queueRow()).rejects.toThrow('expected a queue row')
      await db.delete(exercises).where(eq(exercises.id, bare.id))
    })
  })

  describe('outcome upserts from assessments', () => {
    it('records a passed Explanation Assessment as a successful retrieval', async () => {
      await recordExplanationAssessmentOutcome({
        learnerId,
        conceptId,
        passed: true,
      })

      const row = await queueRow()
      expect(row.scheduleStage).toBe(0)
      expect(row.priorityScore).toBeLessThan(
        RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
      )
    })

    it('records a failed Explanation Assessment as a failed retrieval', async () => {
      await recordExplanationAssessmentOutcome({
        learnerId,
        conceptId,
        passed: false,
      })

      const row = await queueRow()
      expect(row.scheduleStage).toBe(0)
      expect(row.priorityScore).toBeGreaterThanOrEqual(
        RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
      )
    })
  })

  describe('getRetrievalQueue', () => {
    it('is empty for a concept before any interaction', async () => {
      // Scoped to this suite's own concept: concurrent suites write queue
      // rows for their own fixture concepts under the same seeded learner.
      const view = await getRetrievalQueue(learnerId)
      const all = [...view.highPriority, ...view.due, ...view.upcoming]
      expect(all.some((entry) => entry.conceptId === conceptId)).toBe(false)
      expect(all.some((entry) => entry.conceptId === otherConceptId)).toBe(
        false,
      )
    })

    it('buckets a due row as Due with concept and mastery annotations', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await makeDue()

      const view = await getRetrievalQueue(learnerId)
      const entry = view.due.find((row) => row.conceptId === conceptId)
      expect(entry).toMatchObject({
        conceptId,
        slug: CONCEPT_SLUG,
        difficulty: 2,
        masteryState: 'practiced',
        status: 'due',
        remediation: false,
      })
      expect(view.dueCount).toBeGreaterThanOrEqual(1)
      expect(view.highPriority.some((row) => row.conceptId === conceptId)).toBe(
        false,
      )
      expect(view.upcoming.some((row) => row.conceptId === conceptId)).toBe(
        false,
      )
    })

    it('buckets a failed-review row as High Priority', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await recordAttemptOutcome(learnerId, exerciseId, false, false)
      await makeDue()

      const view = await getRetrievalQueue(learnerId)
      const entry = view.highPriority.find((row) => row.conceptId === conceptId)
      expect(entry).toMatchObject({
        conceptId,
        status: 'high-priority',
        remediation: true,
        scheduleStage: 0,
      })
      expect(view.dueCount).toBeGreaterThanOrEqual(1)
    })

    it('buckets a future row as Upcoming', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)

      const view = await getRetrievalQueue(learnerId)
      const entry = view.upcoming.find((row) => row.conceptId === conceptId)
      expect(entry).toMatchObject({ conceptId, status: 'upcoming' })
      expect(view.dueCount).toBe(0)
    })

    it('orders High Priority above Due, and by priority within each', async () => {
      await db.insert(retrievalQueue).values([
        {
          learnerId,
          conceptId,
          scheduleStage: 2,
          dueAt: sql`now() - interval '1 hour'`,
          priorityScore: 60,
        },
        {
          learnerId,
          conceptId: otherConceptId,
          scheduleStage: 0,
          dueAt: sql`now() - interval '1 hour'`,
          priorityScore: RETRIEVAL_REMEDIATION_PRIORITY_BOOST + 5,
        },
      ])

      const view = await getRetrievalQueue(learnerId)
      const highPriorityIds = view.highPriority.map((row) => row.conceptId)
      const dueIds = view.due.map((row) => row.conceptId)
      expect(highPriorityIds).toContain(otherConceptId)
      expect(highPriorityIds).not.toContain(conceptId)
      expect(dueIds).toContain(conceptId)
      expect(dueIds).not.toContain(otherConceptId)
    })
  })

  describe('startRetrievalReview', () => {
    it('rejects an unknown concept', async () => {
      await expect(
        startRetrievalReview({
          learnerId,
          conceptId: '00000000-0000-7000-8000-000000000000',
        }),
      ).rejects.toBeInstanceOf(RetrievalError)
      await expect(
        startRetrievalReview({
          learnerId,
          conceptId: '00000000-0000-7000-8000-000000000000',
        }),
      ).rejects.toMatchObject({ code: 'CONCEPT_NOT_FOUND' })
    })

    it('rejects a concept with no queue row', async () => {
      await expect(
        startRetrievalReview({ learnerId, conceptId }),
      ).rejects.toMatchObject({ code: 'CONCEPT_NOT_DUE' })
    })

    it('rejects a concept that is not due yet', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)

      await expect(
        startRetrievalReview({ learnerId, conceptId }),
      ).rejects.toMatchObject({ code: 'CONCEPT_NOT_DUE' })
    })

    it('reuses the most recent verified exercise targeting the concept', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await makeDue()

      const review = await startRetrievalReview({ learnerId, conceptId })

      expect(review).toMatchObject({
        exerciseId,
        slug: EXERCISE_SLUG,
        conceptSlug: CONCEPT_SLUG,
        reused: true,
      })
    })

    it('resolves an in-progress review back to its registered exercise', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await makeDue()

      await startRetrievalReview({ learnerId, conceptId })
      const again = await startRetrievalReview({ learnerId, conceptId })

      expect(again.exerciseId).toBe(exerciseId)
    })

    it('generates an independent exercise when the concept has none verified', async () => {
      await db.insert(retrievalQueue).values({
        learnerId,
        conceptId,
        scheduleStage: 0,
        dueAt: sql`now() - interval '1 hour'`,
        priorityScore: 10,
      })
      // A real exercise row that generation would have produced — but NOT
      // joined to the concept, so no verified exercise exists for it (the
      // point of the fallback path).
      const [generatedExercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-retrieval-generated',
          language: 'rust',
          title: 'Generated review fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'pending',
        })
        .returning()
      if (!generatedExercise) throw new Error('expected a persisted exercise')
      generateExerciseMock.mockResolvedValue({
        exercise: {
          id: generatedExercise.id,
          slug: generatedExercise.slug,
          title: generatedExercise.title,
        },
      } as never)

      const review = await startRetrievalReview({ learnerId, conceptId })

      expect(generateExerciseMock).toHaveBeenCalledWith({
        language: 'rust',
        conceptSlug: CONCEPT_SLUG,
        learnerId,
        adversarial: false,
        guidance: 'independent',
      })
      expect(review).toMatchObject({
        exerciseId: generatedExercise.id,
        conceptSlug: CONCEPT_SLUG,
        reused: false,
      })
    })

    it('surfaces a generation failure as REFRESHER_GENERATION_FAILED', async () => {
      await db.insert(retrievalQueue).values({
        learnerId,
        conceptId,
        scheduleStage: 0,
        dueAt: sql`now() - interval '1 hour'`,
        priorityScore: 10,
      })
      generateExerciseMock.mockRejectedValue(new Error('boom'))

      await expect(
        startRetrievalReview({ learnerId, conceptId }),
      ).rejects.toMatchObject({ code: 'REFRESHER_GENERATION_FAILED' })
    })
  })

  describe('Refresher Test outcomes through recordAttemptOutcome', () => {
    it('promotes the reviewed concept to Retained on a full completion', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await makeDue()
      await startRetrievalReview({ learnerId, conceptId })

      await recordAttemptOutcome(learnerId, exerciseId, true, true)

      const states = await getMasteryStates(learnerId, [conceptId])
      expect(states[conceptId]).toBe('retained')
      const row = await queueRow()
      expect(row.scheduleStage).toBe(1)
    })

    it('reverts a Demonstrated concept to Practiced on a failed review', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await advanceMastery(learnerId, [conceptId], 'demonstrated')
      await makeDue()
      await startRetrievalReview({ learnerId, conceptId })

      await recordAttemptOutcome(learnerId, exerciseId, false, false)

      const states = await getMasteryStates(learnerId, [conceptId])
      expect(states[conceptId]).toBe('practiced')
      const row = await queueRow()
      expect(row.scheduleStage).toBe(0)
      expect(row.priorityScore).toBeGreaterThanOrEqual(
        RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
      )
    })

    it('never reverts a concept below Practiced', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await makeDue()
      await startRetrievalReview({ learnerId, conceptId })

      await recordAttemptOutcome(learnerId, exerciseId, false, false)

      const states = await getMasteryStates(learnerId, [conceptId])
      expect(states[conceptId]).toBe('practiced')
    })

    it('preserves prior attempt history on a failed review', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await advanceMastery(learnerId, [conceptId], 'demonstrated')
      await makeDue()
      await startRetrievalReview({ learnerId, conceptId })

      // Two prior attempts on the concept — history that must survive.
      await db.insert(attempts).values({
        learnerId,
        exerciseId,
        code: 'x',
        timeToSolution: 0,
        outcome: 'pass',
      })
      await db.insert(attempts).values({
        learnerId,
        exerciseId,
        code: 'y',
        timeToSolution: 1,
        outcome: 'pass',
      })

      await recordAttemptOutcome(learnerId, exerciseId, false, false)

      const attemptsForExercise = await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(eq(attempts.exerciseId, exerciseId))
      expect(attemptsForExercise.length).toBe(2)
    })

    it('applies review semantics only to the registered concept', async () => {
      const exerciseId = await seedVerifiedExercise()
      await recordAttemptOutcome(learnerId, exerciseId, true, true)
      await makeDue()
      await startRetrievalReview({ learnerId, conceptId })

      const [otherExercise] = await db
        .insert(exercises)
        .values({
          slug: 'test-retrieval-other-exercise',
          language: 'rust',
          title: 'Other fixture',
          prompt: 'p',
          starterCode: 's',
          difficulty: 1,
          status: 'verified',
        })
        .returning()
      if (!otherExercise) throw new Error('expected a persisted exercise')
      await db.insert(exerciseConcepts).values({
        exerciseId: otherExercise.id,
        conceptId: otherConceptId,
      })

      await recordAttemptOutcome(learnerId, otherExercise.id, false, false)

      const states = await getMasteryStates(learnerId, [
        conceptId,
        otherConceptId,
      ])
      expect(states[conceptId]).toBe('practiced')
      expect(states[otherConceptId]).toBe('introduced')
      await db
        .delete(exerciseConcepts)
        .where(and(eq(exerciseConcepts.exerciseId, otherExercise.id)))
      await db.delete(attempts).where(eq(attempts.exerciseId, otherExercise.id))
      await db.delete(exercises).where(eq(exercises.id, otherExercise.id))
    })
  })
})
