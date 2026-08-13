import { TeacherEngineError } from '#/lib/ai/client.server'
import { identifySnippetConcepts } from '#/lib/ai/functions.server'
import type { SnippetConcept } from '#/lib/ai/schemas'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): a Tactical Sprint resolves each
// identified concept against the Concept Graph, ad-hoc drafting an unmatched
// one immediately (ADR-0016's runtime-gap case) — one-way, `concepts` never
// imports back from `tactical-sprint`.
import {
  draftFocusedConcept,
  getUsableConceptGraph,
} from '#/features/concepts/concepts.server'
import type { UsableConceptGraph } from '#/features/concepts/concepts.schema'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): once the weakest concept is targeted,
// a Tactical Sprint generates its exercise through `exercise`'s own
// generation pipeline (`sprintScoped`) rather than duplicating it — one-way,
// `exercise` never imports back from `tactical-sprint`.
import { generateExerciseForConcept } from '#/features/exercise/exercise-generation.server'
import type { ExerciseGenerationLanguage } from '#/features/exercise/exercise-generation.schema'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): ranking identified concepts by
// weakness reads the learner's current Learner Model mastery — one-way,
// `learners` never imports back from `tactical-sprint`.
import {
  getMasteryStates,
  MASTERY_STATE_ORDER,
} from '#/features/learners/mastery.server'
import type { MasteryState } from '#/features/learners/mastery.server'

import { TacticalSprintError } from './tactical-sprint.schema'
import type {
  IdentifiedConcept,
  TacticalSprintResult,
} from './tactical-sprint.schema'

/** One identified concept resolved to a persisted Concept Graph row. */
type ResolvedConcept = {
  conceptId: string
  slug: string
  description: string
  matched: boolean
}

/**
 * Resolves every identified snippet concept against the language's usable
 * Concept Graph (ADR-0016): a slug already in the graph reuses its
 * persisted id; an unmatched slug is ad-hoc drafted and used immediately —
 * the runtime-gap case ADR-0016 settles, never blocking the sprint on
 * review. Duplicate slugs from the identification step collapse to one
 * entry, first occurrence wins.
 */
async function resolveIdentifiedConcepts(input: {
  language: ExerciseGenerationLanguage
  usableGraph: UsableConceptGraph
  concepts: SnippetConcept[]
}): Promise<ResolvedConcept[]> {
  const knownBySlug = new Map(
    input.usableGraph.concepts.map((concept) => [concept.slug, concept]),
  )

  const resolved: ResolvedConcept[] = []
  const seenSlugs = new Set<string>()
  for (const candidate of input.concepts) {
    if (seenSlugs.has(candidate.slug)) {
      continue
    }
    seenSlugs.add(candidate.slug)

    const known = knownBySlug.get(candidate.slug)
    if (known) {
      resolved.push({
        conceptId: known.id,
        slug: candidate.slug,
        description: candidate.description,
        matched: true,
      })
      continue
    }

    const drafted = await draftFocusedConcept({
      language: input.language,
      slug: candidate.slug,
      description: candidate.description,
    })
    resolved.push({
      conceptId: drafted.conceptId,
      slug: drafted.slug,
      description: candidate.description,
      matched: false,
    })
  }

  return resolved
}

/**
 * Picks the mastery-weakest concept among the resolved candidates for this
 * learner (SPEC story 5): the lowest-ranked mastery state
 * (`MASTERY_STATE_ORDER`, `learners/mastery.server.ts`), breaking ties by
 * keeping the first-identified candidate — deterministic and stable rather
 * than arbitrary.
 */
function pickWeakest(
  candidates: ResolvedConcept[],
  masteryStates: Record<string, MasteryState>,
): ResolvedConcept {
  const rankOf = (concept: ResolvedConcept): number =>
    MASTERY_STATE_ORDER[masteryStates[concept.conceptId] ?? 'unknown']

  return candidates.reduce((weakest, candidate) =>
    rankOf(candidate) < rankOf(weakest) ? candidate : weakest,
  )
}

/**
 * Runs one Tactical Sprint (Class B) end to end (SPEC stories 4-7, ticket
 * #13): identifies the concepts a pasted snippet depends on, resolves each
 * against the Concept Graph (ad-hoc drafting an unmatched one immediately,
 * ADR-0016), compares the resolved set against the Learner Model and
 * targets the weakest, then generates a 5-10 minute, Pre-Flight-verified
 * exercise for it (reusing `exercise`'s own generation + retry/circuit-
 * breaker pipeline, `sprintScoped: true`). The returned exercise is a
 * normal persisted `exercises` row joined to the target concept — solving
 * it runs through the exact same Stage 1 -> Stage 2 -> Learner Model
 * pipeline as any other exercise (AC 5), nothing sprint-specific downstream
 * of generation.
 */
export async function runTacticalSprint(input: {
  learnerId: string
  language: ExerciseGenerationLanguage
  snippet: string
}): Promise<TacticalSprintResult> {
  const usableGraph = await getUsableConceptGraph(input.language)

  let identification
  try {
    identification = await identifySnippetConcepts({
      language: input.language,
      snippet: input.snippet,
      knownConceptSlugs: usableGraph.concepts.map((concept) => concept.slug),
    })
  } catch (error) {
    if (error instanceof TeacherEngineError) {
      throw new TacticalSprintError('SNIPPET_ANALYSIS_FAILED')
    }
    throw error
  }

  const resolved = await resolveIdentifiedConcepts({
    language: input.language,
    usableGraph,
    concepts: identification.concepts,
  })

  const masteryStates = await getMasteryStates(
    input.learnerId,
    resolved.map((concept) => concept.conceptId),
  )

  const weakest = pickWeakest(resolved, masteryStates)

  const identifiedConcepts: IdentifiedConcept[] = resolved.map((concept) => ({
    conceptId: concept.conceptId,
    slug: concept.slug,
    description: concept.description,
    matched: concept.matched,
    masteryState: masteryStates[concept.conceptId] ?? 'unknown',
  }))

  const exercise = await generateExerciseForConcept({
    language: input.language,
    conceptSlug: weakest.slug,
    sprintScoped: true,
  })

  return {
    identifiedConcepts,
    targetConceptSlug: weakest.slug,
    exercise,
  }
}
