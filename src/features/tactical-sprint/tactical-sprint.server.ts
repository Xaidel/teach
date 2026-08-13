import { TeacherEngineError } from '#/lib/ai/client.server'
import { identifySnippetConcepts } from '#/lib/ai/functions.server'
import type { SnippetConcept } from '#/lib/ai/schemas'
// Shared constant (src/lib/mastery-states.ts): ranking identified concepts
// by weakness reads the learner's current mastery state ordering, which
// `learners` now publishes from lib rather than a feature-to-feature import.
import { MASTERY_STATE_ORDER, type MasteryState } from '#/lib/mastery-states'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): a Tactical Sprint resolves each
// identified concept against the Concept Graph, deferring drafting until the
// weakest concept is ranked — only that winner is ad-hoc drafted, and only
// when it is unmatched (ADR-0016's runtime-gap case, issue #125) — one-way,
// `concepts` never imports back from `tactical-sprint`.
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
import { getMasteryStates } from '#/features/learners/mastery.server'

import { TacticalSprintError } from './tactical-sprint.schema'
import type {
  IdentifiedConcept,
  TacticalSprintResult,
} from './tactical-sprint.schema'

/**
 * One identified concept resolved against the Concept Graph, not yet
 * drafted. A matched slug carries its persisted id; an unmatched one
 * carries none — drafting it is deferred to whichever candidate wins the
 * weakest-concept ranking (issue #125).
 */
type ResolvedConcept =
  | { matched: true; conceptId: string; slug: string; description: string }
  | { matched: false; conceptId: undefined; slug: string; description: string }

/**
 * Resolves every identified snippet concept against the language's usable
 * Concept Graph (ADR-0016): a slug already in the graph reuses its
 * persisted id; an unmatched slug is left undrafted here. Duplicate slugs
 * from the identification step collapse to one entry, first occurrence
 * wins.
 */
function resolveIdentifiedConcepts(input: {
  usableGraph: UsableConceptGraph
  concepts: SnippetConcept[]
}): ResolvedConcept[] {
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
    resolved.push(
      known
        ? {
            matched: true,
            conceptId: known.id,
            slug: candidate.slug,
            description: candidate.description,
          }
        : {
            matched: false,
            conceptId: undefined,
            slug: candidate.slug,
            description: candidate.description,
          },
    )
  }

  return resolved
}

/** A resolved concept annotated with the learner's mastery on it. */
type RankedConcept = ResolvedConcept & { masteryState: MasteryState }

/**
 * Picks the mastery-weakest concept among the ranked candidates for this
 * learner (SPEC story 5): the lowest-ranked mastery state
 * (`MASTERY_STATE_ORDER`, `src/lib/mastery-states.ts`), breaking ties by
 * keeping the first-identified candidate — deterministic and stable rather
 * than arbitrary. An unmatched candidate's `unknown` mastery state
 * (`runTacticalSprint`) is deterministically the lowest rank, so ranking
 * never needs to draft a candidate first to know where it falls.
 */
function pickWeakest(candidates: RankedConcept[]): RankedConcept {
  const rankOf = (concept: RankedConcept): number =>
    MASTERY_STATE_ORDER[concept.masteryState]

  return candidates.reduce((weakest, candidate) =>
    rankOf(candidate) < rankOf(weakest) ? candidate : weakest,
  )
}

/**
 * Runs one Tactical Sprint (Class B) end to end (SPEC stories 4-7, ticket
 * #13): identifies the concepts a pasted snippet depends on, resolves each
 * against the Concept Graph, ranks the resolved set against the Learner
 * Model, and targets the weakest — ad-hoc drafting it immediately
 * (ADR-0016's runtime-gap case) only if it's unmatched, so a losing
 * unmatched candidate never costs a draft call or a Concept Graph write
 * (issue #125) — then generates a 5-10 minute, Pre-Flight-verified exercise
 * for it (reusing `exercise`'s own generation + retry/circuit-breaker
 * pipeline, `sprintScoped: true`). The returned exercise is a normal
 * persisted `exercises` row joined to the target concept — solving it runs
 * through the exact same Stage 1 -> Stage 2 -> Learner Model pipeline as
 * any other exercise (AC 5), nothing sprint-specific downstream of
 * generation.
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

  const resolved = resolveIdentifiedConcepts({
    usableGraph,
    concepts: identification.concepts,
  })

  // Only matched candidates have a persisted id to look up mastery for; an
  // unmatched one is deterministically `unknown` (the lowest rank) without
  // needing a lookup.
  const matchedConceptIds = resolved.flatMap((concept) =>
    concept.matched ? [concept.conceptId] : [],
  )
  const masteryStates = await getMasteryStates(
    input.learnerId,
    matchedConceptIds,
  )

  const ranked: RankedConcept[] = resolved.map((concept) =>
    concept.matched
      ? {
          ...concept,
          masteryState: masteryStates[concept.conceptId] ?? 'unknown',
        }
      : { ...concept, masteryState: 'unknown' },
  )

  const weakest = pickWeakest(ranked)

  // Only the winning candidate is drafted — a losing unmatched candidate
  // stays undrafted (issue #125).
  const targetConceptId = weakest.matched
    ? weakest.conceptId
    : (
        await draftFocusedConcept({
          language: input.language,
          slug: weakest.slug,
          description: weakest.description,
        })
      ).conceptId

  // Keyed by slug rather than reference equality: slugs are unique after
  // `resolveIdentifiedConcepts`' dedup, so the winner is still identified
  // even if `pickWeakest` ever rebuilds its candidate object (issue #128).
  const identifiedConcepts: IdentifiedConcept[] = ranked.map((concept) =>
    concept.slug === weakest.slug
      ? { ...concept, conceptId: targetConceptId }
      : concept,
  )

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
