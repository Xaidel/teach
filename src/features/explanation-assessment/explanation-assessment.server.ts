import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { attempts, concepts, exerciseConcepts, exercises } from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { analyzeMisconceptions } from '#/lib/ai/functions.server'
import type { AnalyzeMisconceptionsOutput } from '#/lib/ai/schemas'
import { isSandboxLanguage } from '#/lib/sandbox/types'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): assessing a concept requires the
// Concept Graph's definition of it (prerequisites/related) and the
// deterministic usability gate — one-way, `concepts` never imports back
// from `explanation-assessment`.
import { getUsableConceptGraph } from '#/features/concepts/concepts.server'
// `UsableConceptGraph` is imported as a type only, from `concepts.schema.ts`
// rather than `concepts.server.ts`: the schema file has no `#/db` or other
// server-only import, so the type is erased at compile time and carries none
// of the bundling risk the `*.server.ts`-to-`*.server.ts` exception in
// `arch_docs/dependency-rules.md` is written to guard against.
import type { UsableConceptGraph } from '#/features/concepts/concepts.schema'
// Same exception: the assessment's pass feeds the Learner Model's
// Practiced → Demonstrated gate (ADR-0015), so this feature reports through
// the single named entry point `learners/mastery.server.ts` exposes for it
// and reads evidence back through its evidence reads — one-way, `learners`
// never imports back from `explanation-assessment`.
import {
  getMasteryStates,
  getPassedExplanationAssessmentConceptIds,
  recordExplanationAssessmentOutcome,
} from '#/features/learners/mastery.server'

import {
  computeExplanationAccuracy,
  EXPLANATION_ACCURACY_PASS_THRESHOLD,
} from './accuracy'
import { ExplanationAssessmentError } from './explanation-assessment.schema'
import type {
  ExplanationAssessmentOverview,
  ExplanationAssessmentResult,
} from './explanation-assessment.schema'

/**
 * The language scoped by the practice list (issue #8) and the Concept Graph
 * surface (issue #7): Rust until tickets #19/#20 land Go/Python. The
 * explanation-assessment eligibility read follows the same scope.
 */
const ASSESSMENT_LANGUAGE = 'rust' as const

/**
 * The Concept Graph's definition of one concept (SPEC story 45): the slug
 * plus the slugs of the concepts it is related to — prerequisite and
 * related edges, the graph's only definition content (ADR-0010). Built from
 * the usable graph projection the eligibility check already loads, so the
 * AI prompt always sees the same validated graph the feature gates on.
 */
type ConceptGraphDefinition = {
  conceptSlug: string
  prerequisiteSlugs: string[]
  relatedSlugs: string[]
}

/** Loads one concept's definition from the usable graph projection. */
function getConceptGraphDefinition(
  graph: UsableConceptGraph,
  conceptId: string,
  conceptSlug: string,
): ConceptGraphDefinition {
  const slugById = new Map(
    graph.concepts.map((concept) => [concept.id, concept.slug]),
  )
  const prerequisiteSlugs: string[] = []
  const relatedSlugs: string[] = []
  for (const edge of graph.edges) {
    if (edge.fromConceptId !== conceptId) continue
    const slug = slugById.get(edge.toConceptId)
    if (slug === undefined) continue
    if (edge.kind === 'prerequisite') prerequisiteSlugs.push(slug)
    else relatedSlugs.push(slug)
  }
  return { conceptSlug, prerequisiteSlugs, relatedSlugs }
}

/**
 * The concepts a learner can currently be assessed on (ADR-0015, issue #16):
 * every usable Concept Graph concept at `practiced` — eligible as soon as
 * the concept reaches Practiced, no exercise-count threshold — annotated
 * with whether the learner already passed an assessment on it. Concepts
 * past Practiced (already Demonstrated) are intentionally absent: the
 * initial gate is a one-time promotion check; recurring assessments on
 * Demonstrated concepts are the scheduled-review shape ticket #18 owns.
 */
export async function getExplanationAssessmentOverview(
  learnerId: string,
): Promise<ExplanationAssessmentOverview> {
  const usableGraph = await getUsableConceptGraph(ASSESSMENT_LANGUAGE)
  const conceptIds = usableGraph.concepts.map((concept) => concept.id)

  const masteryStates = await getMasteryStates(learnerId, conceptIds)
  const eligibleIds = conceptIds.filter(
    (conceptId) => masteryStates[conceptId] === 'practiced',
  )

  const passedIds = new Set(
    await getPassedExplanationAssessmentConceptIds(learnerId, eligibleIds),
  )
  const byId = new Map(
    usableGraph.concepts.map((concept) => [concept.id, concept]),
  )

  return {
    language: ASSESSMENT_LANGUAGE,
    concepts: eligibleIds
      .map((conceptId) => {
        const concept = byId.get(conceptId)
        if (!concept) return null
        return {
          conceptId,
          slug: concept.slug,
          difficulty: concept.difficulty,
          hasPassedAssessment: passedIds.has(conceptId),
        }
      })
      .filter(
        (concept): concept is NonNullable<typeof concept> => concept !== null,
      )
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  }
}

/**
 * Persists the explain-mode exercise row an Explanation Assessment is
 * recorded against (ADR-0010: explanation assessments are ordinary
 * `exercises`/`attempts` rows with `mode = explain`). Created lazily on
 * first assessment of a concept and reused by every later attempt;
 * `status = verified` from creation because explain rows skip Pre-Flight
 * validation (it does not apply to them, ADR-0010) — the normal
 * submit/listing paths already exclude them (no test source, and the
 * practice list filters explain mode out). Returns the row's id.
 */
async function ensureExplainExercise(concept: {
  id: string
  slug: string
  language: string
  difficulty: number
}): Promise<string> {
  const slug = `explain-${concept.slug}`

  const [inserted] = await db
    .insert(exercises)
    .values({
      slug,
      language: concept.language,
      title: `Explain: ${concept.slug}`,
      prompt: 'Explain this concept in your own words.',
      starterCode: '',
      mode: 'explain',
      difficulty: concept.difficulty,
      status: 'verified',
    })
    .onConflictDoNothing({ target: [exercises.slug] })
    .returning({ id: exercises.id })

  const exerciseId = inserted?.id ?? (await getExplainExerciseId(slug))
  if (!exerciseId) {
    throw new Error('The explain exercise insert returned no row.')
  }

  await db
    .insert(exerciseConcepts)
    .values({ exerciseId, conceptId: concept.id })
    .onConflictDoNothing()

  return exerciseId
}

/** The persisted explain exercise for a slug, or null before first creation. */
async function getExplainExerciseId(slug: string): Promise<string | null> {
  const row = await db.query.exercises.findFirst({
    where: eq(exercises.slug, slug),
  })
  return row?.id ?? null
}

/**
 * Runs one Explanation Assessment end to end (SPEC stories 44-45, issue
 * #16): validates the concept is gate-eligible (usable, at Practiced), has
 * the AI Teacher Engine compare the learner's explanation against the
 * concept's Concept Graph definition, computes the accuracy score
 * deterministically app-side (ticket #16's formula), persists the
 * assessment as an explain-mode attempt, and reports the outcome to the
 * Learner Model — which promotes the concept to Demonstrated only once a
 * passed Transfer Test is also recorded (ADR-0015, ticket #17's seam). A
 * failed attempt leaves the concept at Practiced with a retry available;
 * each attempt, pass or fail, is recorded as evidence (SPEC story 42).
 */
export async function submitExplanationAssessment(input: {
  learnerId: string
  conceptId: string
  explanation: string
}): Promise<ExplanationAssessmentResult> {
  const concept = await db.query.concepts.findFirst({
    where: eq(concepts.id, input.conceptId),
  })
  if (!concept) {
    throw new ExplanationAssessmentError('CONCEPT_NOT_FOUND')
  }

  // The concept row's language column is text; assessment only makes sense
  // for a language with a usable Concept Graph (mirrors the practice
  // listing's own language guard, exercise.server.ts).
  if (!isSandboxLanguage(concept.language)) {
    throw new ExplanationAssessmentError('CONCEPT_NOT_ELIGIBLE')
  }

  const usableGraph = await getUsableConceptGraph(concept.language)
  if (!usableGraph.concepts.some((c) => c.id === concept.id)) {
    throw new ExplanationAssessmentError('CONCEPT_NOT_ELIGIBLE')
  }

  const mastery = (await getMasteryStates(input.learnerId, [concept.id]))[
    concept.id
  ]
  if (mastery !== 'practiced') {
    throw new ExplanationAssessmentError('CONCEPT_NOT_ELIGIBLE')
  }

  const definition = getConceptGraphDefinition(
    usableGraph,
    concept.id,
    concept.slug,
  )

  let analysis: AnalyzeMisconceptionsOutput
  try {
    analysis = await analyzeMisconceptions({
      language: concept.language,
      conceptSlug: definition.conceptSlug,
      prerequisiteSlugs: definition.prerequisiteSlugs,
      relatedSlugs: definition.relatedSlugs,
      learnerExplanation: input.explanation,
    })
  } catch (error) {
    if (error instanceof TeacherEngineError) {
      throw new ExplanationAssessmentError('EXPLANATION_ANALYSIS_FAILED')
    }
    throw error
  }

  const accuracyScore = computeExplanationAccuracy({
    conceptSlug: definition.conceptSlug,
    prerequisiteSlugs: definition.prerequisiteSlugs,
    analysis,
  })
  const passed = accuracyScore >= EXPLANATION_ACCURACY_PASS_THRESHOLD

  const exerciseId = await ensureExplainExercise(concept)

  await db.insert(attempts).values({
    learnerId: input.learnerId,
    exerciseId,
    code: input.explanation,
    // No `outcome` for an explain-mode attempt: it has no Stage 1 sandbox
    // verdict, and the pass/fail signal lives in the payload alone
    // (ADR-0010, ADR-0021 — the column is NULL for these rows).
    // No meaningful time-to-solution for an assessment either: the evidence
    // story 42 asks for is the accuracy signal, not how long the
    // explanation took.
    timeToSolution: 0,
    explanationAssessment: { accuracyScore, analysis },
  })

  await recordExplanationAssessmentOutcome({
    learnerId: input.learnerId,
    conceptId: concept.id,
    passed,
  })

  const masteryState =
    (await getMasteryStates(input.learnerId, [concept.id]))[concept.id] ??
    'unknown'

  return {
    accuracyScore,
    passed,
    analysis,
    masteryState,
  }
}
