import { and, desc, eq, isNull } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { curriculumLessons, exerciseConcepts, exercises } from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { explainConcept } from '#/lib/ai/functions.server'

// Deliberate, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): the Class A sequence is derived from the
// Concept Validation-passing projection, so `curriculum` depends one-way on the
// single named entry point `concepts/concepts.server.ts` exposes for this.
// `concepts` never imports back from `curriculum`.
import { getUsableConceptGraph } from '../concepts/concepts.server'
import type { UsableConceptGraph } from '../concepts/concepts.schema'
// Same exception: a step's guided/independent exercises are banked through the
// same Pre-Flight-verified generation pipeline every other exercise uses, so
// `curriculum` depends one-way on `generateExerciseForConcept` and the row →
// client-safe exercise contract `rowToExercise`. `exercise` never imports back.
import { generateExerciseForConcept } from '../exercise/exercise-generation.server'
import { rowToExercise } from '../exercise/exercise.server'
// Same exception: the no-skip-ahead gate and the per-concept progress badge
// read the Learner Model's mastery states, so `curriculum` depends one-way on
// `getMasteryStates`, `getExplanationPreferences` and the shared
// "Practiced or better" predicate. The learners feature never imports back.
import { getExplanationPreferences } from '../learners/learners.server'
import {
  allPracticedOrBetter,
  getMasteryStates,
  isPracticedOrBetter,
} from '../learners/mastery.server'
// Same exception: the no-skip-ahead gate (AC 4) is owned by the Concept
// Graph, so the curriculum surfaces depend one-way on the single named
// entry point `concepts/concepts.server.ts` exposes for it, remapping its
// error to the curriculum's stable `CURRICULUM_LOCKED` contract.
import { assertPrerequisitesPracticed } from '../concepts/concepts.server'
// `ConceptError` is imported as a value (not just a type) for the
// `instanceof` check below. It arrives through the same named entry point
// as the gate that throws it — `concepts.server.ts` re-exports it
// (arch_docs/dependency-rules.md "Feature Dependencies" exception) — rather
// than reaching into `concepts.schema.ts`, which the documented exception is
// written for `*.server.ts`-to-`*.server.ts` imports only.
import { ConceptError } from '../concepts/concepts.server'
import type { MasteryState } from '../learners/mastery.server'
import type { Exercise, ExerciseGuidance } from '../exercise/exercise.schema'

import { orderCurriculum } from './curriculum-order'
import { CurriculumError } from './curriculum.schema'
import type {
  Curriculum,
  CurriculumLanguage,
  CurriculumLesson,
  CurriculumStep,
  CurriculumStepDetail,
  CurriculumStepStatus,
} from './curriculum.schema'

/**
 * The no-skip-ahead gate (AC 4): a step is only actionable once every
 * direct prerequisite in the usable graph is Practiced. The check itself
 * is owned by the Concept Graph (`assertPrerequisitesPracticed`); this
 * wrapper remaps its error to the curriculum's stable `CURRICULUM_LOCKED`
 * contract, so the curriculum surfaces keep their documented error code
 * and message. Thrown by lesson generation and step-exercise generation —
 * the UI lock is presentation, this is the enforcement.
 */
async function assertStepUnlocked(
  learnerId: string,
  language: CurriculumLanguage,
  conceptId: string,
): Promise<void> {
  try {
    await assertPrerequisitesPracticed({
      learnerId,
      language,
      conceptIds: [conceptId],
    })
  } catch (error) {
    if (error instanceof ConceptError) {
      throw new CurriculumError('CURRICULUM_LOCKED')
    }
    throw error
  }
}

/**
 * Derives a step's status from its mastery and gate (issue #14): a concept
 * is `complete` at Practiced and above, `locked` while any prerequisite is
 * below Practiced (the no-skip-ahead gate, AC 4), `started` after the first
 * attempt, and `available` otherwise. Complete wins over locked so a
 * concept mastered outside the curriculum (the standalone generation card)
 * is never re-locked by an unmastered prerequisite.
 */
function deriveStatus(
  mastery: MasteryState,
  prerequisitesPracticed: boolean,
): CurriculumStepStatus {
  if (isPracticedOrBetter(mastery)) return 'complete'
  if (!prerequisitesPracticed) return 'locked'
  if (mastery !== 'unknown') return 'started'
  return 'available'
}

/** The direct prerequisite concepts of one concept, from prerequisite edges. */
function prerequisiteConceptsOf(
  graph: UsableConceptGraph,
  conceptId: string,
): { id: string; slug: string }[] {
  const conceptIds = new Set(
    graph.edges
      .filter(
        (edge) =>
          edge.kind === 'prerequisite' && edge.toConceptId === conceptId,
      )
      .map((edge) => edge.fromConceptId),
  )
  return graph.concepts
    .filter((concept) => conceptIds.has(concept.id))
    .map((concept) => ({ id: concept.id, slug: concept.slug }))
}

/** The ordered Class A sequence with per-step mastery and status. */
async function buildCurriculum(
  learnerId: string,
  language: CurriculumLanguage,
): Promise<{ graph: UsableConceptGraph; curriculum: Curriculum }> {
  const graph = await getUsableConceptGraph(language)
  const ordered = orderCurriculum(graph)

  const mastery = await getMasteryStates(
    learnerId,
    ordered.map((entry) => entry.conceptId),
  )

  const steps: CurriculumStep[] = ordered.map((entry, index) => {
    const concept = graph.concepts.find((c) => c.id === entry.conceptId)
    if (!concept) {
      throw new CurriculumError('CONCEPT_NOT_IN_CURRICULUM')
    }
    const prerequisites = prerequisiteConceptsOf(graph, entry.conceptId)
    const prerequisitesPracticed = allPracticedOrBetter(
      prerequisites.map((prerequisite) => prerequisite.id),
      mastery,
    )
    return {
      position: index + 1,
      concept: {
        id: concept.id,
        slug: concept.slug,
        difficulty: concept.difficulty,
      },
      prerequisites,
      mastery: mastery[entry.conceptId] ?? 'unknown',
      status: deriveStatus(
        mastery[entry.conceptId] ?? 'unknown',
        prerequisitesPracticed,
      ),
    }
  })

  return {
    graph,
    curriculum: { language, steps },
  }
}

/**
 * The Class A curriculum sequence for one language (SPEC story 1, issue
 * #14): the usable Concept Graph's concepts ordered by their prerequisite
 * DAG, each step carrying the learner's mastery and the derived status that
 * gates it. The sequence is recomputed at read time from the graph and the
 * Learner Model, so it can never drift from either.
 */
export async function getCurriculum(
  learnerId: string,
  language: CurriculumLanguage,
): Promise<Curriculum> {
  const { curriculum } = await buildCurriculum(learnerId, language)
  return curriculum
}

/** Resolves one concept's usable-graph row by slug, or throws. */
function resolveConcept(
  graph: UsableConceptGraph,
  conceptSlug: string,
): { id: string; slug: string; difficulty: number } {
  const concept = graph.concepts.find((c) => c.slug === conceptSlug)
  if (!concept) {
    throw new CurriculumError('CONCEPT_NOT_IN_CURRICULUM')
  }
  return concept
}

/** The most recent verified exercise banked for one step slot, or null. */
async function latestSlotExercise(
  conceptId: string,
  guidance: ExerciseGuidance,
): Promise<Exercise | null> {
  const rows = await db
    .select({ exercise: exercises })
    .from(exercises)
    .innerJoin(exerciseConcepts, eq(exerciseConcepts.exerciseId, exercises.id))
    .where(
      and(
        eq(exercises.status, 'verified'),
        eq(exercises.guidance, guidance),
        eq(exerciseConcepts.conceptId, conceptId),
      ),
    )
    .orderBy(desc(exercises.createdAt))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return rowToExercise(row.exercise)
}

/**
 * One step's detail view (SPEC story 2, issue #14): the step plus the
 * verified exercises already banked for its guided and independent slots.
 * Readable for locked steps too — the page renders the lock, and the slot
 * exercises stay visible so re-reading a complete step shows what was done.
 */
export async function getCurriculumStepDetail(input: {
  learnerId: string
  language: CurriculumLanguage
  conceptSlug: string
}): Promise<CurriculumStepDetail> {
  const { graph, curriculum } = await buildCurriculum(
    input.learnerId,
    input.language,
  )
  const concept = resolveConcept(graph, input.conceptSlug)
  const step = curriculum.steps.find((s) => s.concept.id === concept.id)
  if (!step) {
    throw new CurriculumError('CONCEPT_NOT_IN_CURRICULUM')
  }

  const [guidedExercise, independentExercise] = await Promise.all([
    latestSlotExercise(concept.id, 'guided'),
    latestSlotExercise(concept.id, 'independent'),
  ])

  return {
    ...step,
    language: input.language,
    guidedExercise,
    independentExercise,
  }
}

/**
 * Generates one step's guided or independent exercise through the same
 * Pre-Flight-verified pipeline as any exercise (issue #14). The no-skip-ahead
 * gate runs before generation: a locked step cannot mint an exercise, so a
 * learner can never work ahead of their mastered prerequisites. The output
 * shape is the exercise feature's generation output (a verified-fallback
 * may serve a previously banked row for the concept, preserving the
 * circuit-breaker contract of SPEC story 34).
 */
export async function generateStepExercise(input: {
  learnerId: string
  language: CurriculumLanguage
  conceptSlug: string
  guidance: ExerciseGuidance
}) {
  const graph = await getUsableConceptGraph(input.language)
  const concept = resolveConcept(graph, input.conceptSlug)
  await assertStepUnlocked(input.learnerId, input.language, concept.id)

  return generateExerciseForConcept({
    language: input.language,
    conceptSlug: input.conceptSlug,
    learnerId: input.learnerId,
    guidance: input.guidance,
  })
}

/**
 * Generates the step's lesson (SPEC story 2, issue #14): the AI Teacher
 * Engine explains the concept, phrased at the learner's current explanation
 * depth and reference frame (issue #12) — presentation only, never a gate.
 * The lesson is cached durably per learner/concept/explanation-settings
 * (issue #135): a revisiting learner is served the cached text instead of
 * paying a fresh generation call, and the cache key includes the
 * explanation depth and reference frame, so a change in either setting
 * naturally misses and regenerates. Only a successful generation is
 * persisted — a failed call never poisons the cache. Generation failures
 * surface as a stable `LESSON_GENERATION_FAILED` error.
 */
export async function generateCurriculumLesson(input: {
  learnerId: string
  language: CurriculumLanguage
  conceptSlug: string
}): Promise<CurriculumLesson> {
  const graph = await getUsableConceptGraph(input.language)
  const concept = resolveConcept(graph, input.conceptSlug)
  await assertStepUnlocked(input.learnerId, input.language, concept.id)

  const preferences = await getExplanationPreferences(input.learnerId)

  const cached = await db.query.curriculumLessons.findFirst({
    where: and(
      eq(curriculumLessons.learnerId, input.learnerId),
      eq(curriculumLessons.conceptId, concept.id),
      eq(curriculumLessons.explanationDepth, preferences.depth),
      // A nullable reference frame must match with `IS NULL`, not `= NULL`.
      ...(preferences.referenceFrame === null
        ? [isNull(curriculumLessons.referenceFrame)]
        : [eq(curriculumLessons.referenceFrame, preferences.referenceFrame)]),
    ),
  })
  if (cached) {
    return { concept: input.conceptSlug, explanation: cached.explanation }
  }

  let explanation: string
  try {
    const output = await explainConcept({
      language: input.language,
      concept: input.conceptSlug,
      depth: preferences.depth,
      ...(preferences.referenceFrame === null
        ? {}
        : { referenceFrame: preferences.referenceFrame }),
    })
    explanation = output.explanation
  } catch (error) {
    if (error instanceof TeacherEngineError) {
      throw new CurriculumError('LESSON_GENERATION_FAILED')
    }
    throw error
  }

  await db.insert(curriculumLessons).values({
    learnerId: input.learnerId,
    conceptId: concept.id,
    explanationDepth: preferences.depth,
    referenceFrame: preferences.referenceFrame,
    explanation,
  })
  return { concept: input.conceptSlug, explanation }
}
