import { and, eq, inArray, like, or, sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('../exercise/exercise-generation.server', () => ({
  generateExerciseForConcept: vi.fn(),
}))

vi.mock('#/lib/ai/functions.server', () => ({
  explainConcept: vi.fn(),
}))

import { db } from '#/db/client.server'
import {
  conceptEdges,
  concepts,
  curriculumLessons,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  learners,
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { explainConcept } from '#/lib/ai/functions.server'
import { DEFAULT_EXPLANATION_DEPTH } from '#/lib/explanation-depth'
import { withLearnerPreferencesLock } from '#/lib/test-utils/learner-preferences-lock'
import { generateExerciseForConcept } from '../exercise/exercise-generation.server'
import type { GenerateExerciseOutput } from '../exercise/exercise-generation.schema'

import { advanceMastery } from '../learners/mastery.server'
import {
  getCurrentLearnerId,
  updateExplanationPreferences,
} from '../learners/learners.server'

import {
  generateCurriculumLesson,
  generateStepExercise,
  getCurriculum,
  getCurriculumStepDetail,
} from './curriculum.server'
import { CurriculumError } from './curriculum.schema'
import type { Curriculum, CurriculumStep } from './curriculum.schema'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()
const generateExerciseForConceptMock = vi.mocked(generateExerciseForConcept)
const explainConceptMock = vi.mocked(explainConcept)

/** Looks up one curriculum step by fixture slug, failing the test when absent. */
function stepBySlug(curriculum: Curriculum, slug: string): CurriculumStep {
  const step = curriculum.steps.find((s) => s.concept.slug === slug)
  if (!step) throw new Error(`expected curriculum step ${slug}`)
  return step
}

/**
 * A small connected slice of the Rust Concept Graph (AC 1): the chain
 * root → basic → advanced, plus an independent concept that shares no
 * prerequisite path with the chain.
 */
const CONCEPT_ROOT = {
  id: '44444444-4444-4444-8444-444444444401',
  slug: 'test.curriculum.root',
}
const CONCEPT_BASIC = {
  id: '44444444-4444-4444-8444-444444444402',
  slug: 'test.curriculum.basic',
}
const CONCEPT_ADVANCED = {
  id: '44444444-4444-4444-8444-444444444403',
  slug: 'test.curriculum.advanced',
}
const CONCEPT_ALONE = {
  id: '44444444-4444-4444-8444-444444444404',
  slug: 'test.curriculum.alone',
}

const FIXTURE_CONCEPT_IDS = [
  CONCEPT_ROOT.id,
  CONCEPT_BASIC.id,
  CONCEPT_ADVANCED.id,
  CONCEPT_ALONE.id,
]

describe.skipIf(!dbUp)('curriculum.server', () => {
  let learnerId: string

  // The shared learner's preferences this suite mutated (issue #135), so
  // `afterEach` can restore exactly what it set — and only while that value
  // still holds. A plain unconditional restore would clobber a preference a
  // concurrent suite is mid-way through changing on the same learner row
  // (issue #115).
  let mutatedExplanationDepth: number | null = null
  let mutatedReferenceFrame: string | null = null

  /**
   * Pins the shared learner's explanation preferences to the seeded
   * defaults. Only called inside `withLearnerPreferencesLock`, so the
   * unconditional write can never clobber another suite's in-flight
   * mutation (issue #115): the lock guarantees no other mutator is
   * mid-window.
   */
  async function resetLearnerPreferences(): Promise<void> {
    await db
      .update(learners)
      .set({
        explanationDepth: DEFAULT_EXPLANATION_DEPTH,
        referenceFrame: null,
      })
      .where(eq(learners.id, learnerId))
  }

  beforeAll(async () => {
    learnerId = await getCurrentLearnerId()

    await db
      .insert(concepts)
      .values([
        {
          id: CONCEPT_ROOT.id,
          language: 'rust',
          slug: CONCEPT_ROOT.slug,
          difficulty: 1,
        },
        {
          id: CONCEPT_BASIC.id,
          language: 'rust',
          slug: CONCEPT_BASIC.slug,
          difficulty: 2,
        },
        {
          id: CONCEPT_ADVANCED.id,
          language: 'rust',
          slug: CONCEPT_ADVANCED.slug,
          difficulty: 3,
        },
        {
          id: CONCEPT_ALONE.id,
          language: 'rust',
          slug: CONCEPT_ALONE.slug,
          difficulty: 1,
        },
      ])
      .onConflictDoNothing({
        target: [concepts.language, concepts.slug],
      })

    await db
      .insert(conceptEdges)
      .values([
        {
          fromConceptId: CONCEPT_ROOT.id,
          toConceptId: CONCEPT_BASIC.id,
          kind: 'prerequisite',
        },
        {
          fromConceptId: CONCEPT_BASIC.id,
          toConceptId: CONCEPT_ADVANCED.id,
          kind: 'prerequisite',
        },
      ])
      .onConflictDoNothing({
        target: [
          conceptEdges.fromConceptId,
          conceptEdges.toConceptId,
          conceptEdges.kind,
        ],
      })
  })

  afterAll(async () => {
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          inArray(learnerConceptMastery.conceptId, FIXTURE_CONCEPT_IDS),
        ),
      )
    // Scoped to this suite's own (learner, fixture-concept) rows (issue
    // #115): an unscoped delete would race concurrent curriculum suites'
    // cached lessons for the same seeded learner.
    await db
      .delete(curriculumLessons)
      .where(
        and(
          eq(curriculumLessons.learnerId, learnerId),
          inArray(curriculumLessons.conceptId, FIXTURE_CONCEPT_IDS),
        ),
      )
    await db
      .delete(exerciseConcepts)
      .where(inArray(exerciseConcepts.conceptId, FIXTURE_CONCEPT_IDS))
    await db.delete(exercises).where(like(exercises.slug, 'test-curriculum-%'))
    await db
      .delete(conceptEdges)
      .where(
        or(
          inArray(conceptEdges.fromConceptId, FIXTURE_CONCEPT_IDS),
          inArray(conceptEdges.toConceptId, FIXTURE_CONCEPT_IDS),
        ),
      )
    await db.delete(concepts).where(inArray(concepts.id, FIXTURE_CONCEPT_IDS))
  })

  afterEach(async () => {
    await db
      .delete(learnerConceptMastery)
      .where(
        and(
          eq(learnerConceptMastery.learnerId, learnerId),
          inArray(learnerConceptMastery.conceptId, FIXTURE_CONCEPT_IDS),
        ),
      )
    // Scoped to this suite's own rows (issue #115), like the afterAll above.
    await db
      .delete(curriculumLessons)
      .where(
        and(
          eq(curriculumLessons.learnerId, learnerId),
          inArray(curriculumLessons.conceptId, FIXTURE_CONCEPT_IDS),
        ),
      )
    // Restore only the preference this suite set, and only while it still
    // holds — never clobber a value another suite changed concurrently on
    // the shared learner (issue #115).
    if (mutatedExplanationDepth !== null) {
      await db
        .update(learners)
        .set({ explanationDepth: DEFAULT_EXPLANATION_DEPTH })
        .where(
          and(
            eq(learners.id, learnerId),
            eq(learners.explanationDepth, mutatedExplanationDepth),
          ),
        )
      mutatedExplanationDepth = null
    }
    if (mutatedReferenceFrame !== null) {
      await db
        .update(learners)
        .set({ referenceFrame: null })
        .where(
          and(
            eq(learners.id, learnerId),
            eq(learners.referenceFrame, mutatedReferenceFrame),
          ),
        )
      mutatedReferenceFrame = null
    }
    generateExerciseForConceptMock.mockReset()
    explainConceptMock.mockReset()
  })

  it('orders the sequence by prerequisites and derives locked statuses', async () => {
    const curriculum = await getCurriculum(learnerId, 'rust')

    const root = stepBySlug(curriculum, CONCEPT_ROOT.slug)
    const basic = stepBySlug(curriculum, CONCEPT_BASIC.slug)
    const advanced = stepBySlug(curriculum, CONCEPT_ADVANCED.slug)

    expect(root.position).toBeLessThan(basic.position)
    expect(basic.position).toBeLessThan(advanced.position)
    expect(root.prerequisites).toEqual([])
    expect(basic.prerequisites.map((p) => p.slug)).toEqual([CONCEPT_ROOT.slug])
    expect(advanced.prerequisites.map((p) => p.slug)).toEqual([
      CONCEPT_BASIC.slug,
    ])

    expect(root.status).toBe('available')
    expect(basic.status).toBe('locked')
    expect(advanced.status).toBe('locked')
  })

  it('unlocks a step once every prerequisite is Practiced (AC 4)', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')

    const curriculum = await getCurriculum(learnerId, 'rust')

    expect(stepBySlug(curriculum, CONCEPT_ROOT.slug).status).toBe('complete')
    expect(stepBySlug(curriculum, CONCEPT_BASIC.slug).status).toBe('available')
    expect(stepBySlug(curriculum, CONCEPT_ADVANCED.slug).status).toBe('locked')
  })

  it('marks a step started after the first attempt and complete at Practiced', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    await advanceMastery(learnerId, [CONCEPT_BASIC.id], 'introduced')

    expect(
      stepBySlug(await getCurriculum(learnerId, 'rust'), CONCEPT_BASIC.slug)
        .status,
    ).toBe('started')

    await advanceMastery(learnerId, [CONCEPT_BASIC.id], 'practiced')
    const after = await getCurriculum(learnerId, 'rust')
    expect(stepBySlug(after, CONCEPT_BASIC.slug).status).toBe('complete')
    expect(stepBySlug(after, CONCEPT_ADVANCED.slug).status).toBe('available')
  })

  it('keeps a concept complete even when its prerequisite is not Practiced', async () => {
    // Mastered through the standalone generation card — no curriculum gating.
    await advanceMastery(learnerId, [CONCEPT_BASIC.id], 'practiced')

    const curriculum = await getCurriculum(learnerId, 'rust')
    expect(stepBySlug(curriculum, CONCEPT_BASIC.slug).status).toBe('complete')
    expect(stepBySlug(curriculum, CONCEPT_ROOT.slug).status).toBe('available')
  })

  it('rejects step exercise generation for a locked step before any generation', async () => {
    await expect(
      generateStepExercise({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_ADVANCED.slug,
        guidance: 'guided',
      }),
    ).rejects.toBeInstanceOf(CurriculumError)
    expect(generateExerciseForConceptMock).not.toHaveBeenCalled()
  })

  it('generates a step exercise through the pipeline once unlocked', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    await advanceMastery(learnerId, [CONCEPT_BASIC.id], 'practiced')

    const output: GenerateExerciseOutput = {
      kind: 'generated',
      exercise: {
        id: 'e-1',
        slug: 'test-curriculum-advanced-a1b2c3d4',
        language: 'rust',
        title: 'Advanced exercise',
        prompt: 'Implement it.',
        starterCode: 'pub fn x() {}',
        guidance: 'independent',
        sampleTests: null,
      },
      conceptSlug: CONCEPT_ADVANCED.slug,
      targetConcepts: [CONCEPT_ADVANCED.slug],
      prerequisites: [],
      estimatedMinutes: 5,
      constraints: ['std_only'],
      preflight: {
        attemptNumber: 1,
        passed: true,
        checks: [{ name: 'reference_passes', passed: true }],
      },
      simplified: false,
    }
    generateExerciseForConceptMock.mockResolvedValue(output)

    await expect(
      generateStepExercise({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_ADVANCED.slug,
        guidance: 'independent',
      }),
    ).resolves.toBe(output)
    expect(generateExerciseForConceptMock).toHaveBeenCalledWith({
      language: 'rust',
      conceptSlug: CONCEPT_ADVANCED.slug,
      learnerId,
      guidance: 'independent',
    })
  })

  it('rejects lesson generation for a locked step', async () => {
    await expect(
      generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      }),
    ).rejects.toBeInstanceOf(CurriculumError)
    expect(explainConceptMock).not.toHaveBeenCalled()
  })

  it('generates a lesson once unlocked', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    explainConceptMock.mockResolvedValue({
      explanation: 'Borrowing transfers access for a while.',
    })

    await expect(
      generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      }),
    ).resolves.toEqual({
      concept: CONCEPT_BASIC.slug,
      explanation: 'Borrowing transfers access for a while.',
    })
    expect(explainConceptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'rust',
        concept: CONCEPT_BASIC.slug,
      }),
    )
  })

  it('maps a failed Teacher Engine lesson call to a stable error', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    explainConceptMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'the model was down'),
    )

    await expect(
      generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      }),
    ).rejects.toBeInstanceOf(CurriculumError)

    // A failed call never writes a cache row (ADR-0024) — the request never
    // reaches the insert, so no lesson is persisted for this key.
    const rows = await db
      .select({ id: curriculumLessons.id })
      .from(curriculumLessons)
      .where(
        and(
          eq(curriculumLessons.learnerId, learnerId),
          eq(curriculumLessons.conceptId, CONCEPT_BASIC.id),
        ),
      )
    expect(rows).toHaveLength(0)
  })

  it('serves a cached lesson without a fresh AI call on revisit (issue #135)', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    explainConceptMock.mockResolvedValue({
      explanation: 'Borrowing transfers access for a while.',
    })

    // Pin the shared learner's preferences to the defaults under the lock
    // so both generates use the same cache key no matter what state a
    // previous test left behind (issue #115/#135).
    await withLearnerPreferencesLock(async () => {
      await resetLearnerPreferences()

      const first = await generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      })
      expect(explainConceptMock).toHaveBeenCalledTimes(1)

      // The mock would throw if called again — a fresh call must not happen.
      explainConceptMock.mockRejectedValue(
        new Error('unexpected second AI call'),
      )
      const second = await generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      })

      expect(second).toEqual(first)
      expect(explainConceptMock).toHaveBeenCalledTimes(1)
    })
  })

  it('regenerates the lesson when the explanation depth changes (issue #135)', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    explainConceptMock.mockResolvedValueOnce({
      explanation: 'Shallow explanation.',
    })
    explainConceptMock.mockResolvedValueOnce({
      explanation: 'Deep explanation.',
    })

    // The preference mutation must not interleave with a concurrent suite's
    // own mutation of the shared learner (issue #115): the cache key read
    // between the two generates has to stay stable for the test's intent.
    await withLearnerPreferencesLock(async () => {
      await resetLearnerPreferences()

      const shallow = await generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      })
      expect(shallow.explanation).toBe('Shallow explanation.')

      mutatedExplanationDepth = 5
      await updateExplanationPreferences(learnerId, { depth: 5 })

      const deep = await generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      })
      expect(deep.explanation).toBe('Deep explanation.')
      expect(explainConceptMock).toHaveBeenCalledTimes(2)
    })
  })

  it('serves a cached lesson under the same non-null reference frame (issue #135)', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')
    // The seeded learner has a NULL frame; set one so the cache lookup
    // exercises the `eq(referenceFrame, ...)` branch (the `isNull` branch
    // is the one every other test's seeded learner takes). Held under the
    // learner-preferences lock, like the depth-change test above.
    await withLearnerPreferencesLock(async () => {
      await resetLearnerPreferences()
      mutatedReferenceFrame = 'as a Go developer'
      await updateExplanationPreferences(learnerId, {
        referenceFrame: 'as a Go developer',
      })
      explainConceptMock.mockResolvedValue({
        explanation: 'Frame-shaped explanation.',
      })

      const first = await generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      })
      expect(explainConceptMock).toHaveBeenCalledTimes(1)
      expect(explainConceptMock).toHaveBeenCalledWith(
        expect.objectContaining({ referenceFrame: 'as a Go developer' }),
      )

      // The mock would throw if called again — a fresh call must not happen.
      explainConceptMock.mockRejectedValue(
        new Error('unexpected second AI call'),
      )
      const second = await generateCurriculumLesson({
        learnerId,
        language: 'rust',
        conceptSlug: CONCEPT_BASIC.slug,
      })

      expect(second).toEqual(first)
      expect(explainConceptMock).toHaveBeenCalledTimes(1)
    })
  })

  it('rejects concepts outside the usable graph', async () => {
    await expect(
      getCurriculumStepDetail({
        learnerId,
        language: 'rust',
        conceptSlug: 'test.curriculum.does-not-exist',
      }),
    ).rejects.toBeInstanceOf(CurriculumError)
  })

  it('surfaces a locked step detail with its gate and no locked-out behavior', async () => {
    const detail = await getCurriculumStepDetail({
      learnerId,
      language: 'rust',
      conceptSlug: CONCEPT_ADVANCED.slug,
    })

    expect(detail.status).toBe('locked')
    expect(detail.prerequisites.map((p) => p.slug)).toEqual([
      CONCEPT_BASIC.slug,
    ])
    expect(detail.guidedExercise).toBeNull()
    expect(detail.independentExercise).toBeNull()
  })

  it('surfaces banked slot exercises on the step detail', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')

    const [exercise] = await db
      .insert(exercises)
      .values({
        slug: 'test-curriculum-guided-1',
        language: 'rust',
        title: 'Guided borrow',
        prompt: "Borrow, don't move.",
        starterCode: 'pub fn first(v: Vec<u32>) -> u32 { v[0] }',
        testSource: '#[test]\nfn t() {}',
        referenceSolution: 'pub fn first(v: &Vec<u32>) -> u32 { v[0] }',
        mode: 'implement',
        guidance: 'guided',
        difficulty: 2,
        status: 'verified',
      })
      .returning()
    if (!exercise) throw new Error('expected a persisted exercise')
    await db.insert(exerciseConcepts).values({
      exerciseId: exercise.id,
      conceptId: CONCEPT_BASIC.id,
    })

    const detail = await getCurriculumStepDetail({
      learnerId,
      language: 'rust',
      conceptSlug: CONCEPT_BASIC.slug,
    })

    expect(detail.guidedExercise).toMatchObject({
      id: exercise.id,
      slug: 'test-curriculum-guided-1',
      guidance: 'guided',
    })
    expect(detail.independentExercise).toBeNull()

    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.exerciseId, exercise.id))
    await db.delete(exercises).where(eq(exercises.id, exercise.id))
  })

  it('reflects Learner Model updates in the sequence (AC 3)', async () => {
    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'introduced')

    const before = await getCurriculum(learnerId, 'rust')
    expect(stepBySlug(before, CONCEPT_ROOT.slug).mastery).toBe('introduced')
    expect(stepBySlug(before, CONCEPT_ROOT.slug).status).toBe('started')

    await advanceMastery(learnerId, [CONCEPT_ROOT.id], 'practiced')

    const after = await getCurriculum(learnerId, 'rust')
    expect(stepBySlug(after, CONCEPT_ROOT.slug).mastery).toBe('practiced')
    expect(stepBySlug(after, CONCEPT_ROOT.slug).status).toBe('complete')
  })

  it('includes every usable concept exactly once in the sequence', async () => {
    const curriculum = await getCurriculum(learnerId, 'rust')
    const slugs = curriculum.steps.map((step) => step.concept.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs).toContain(CONCEPT_ALONE.slug)
    expect(slugs).toContain(CONCEPT_ROOT.slug)
  })
})
