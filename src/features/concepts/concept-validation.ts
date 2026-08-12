import type { ConceptDraft, ConceptEdgeDraft } from '#/lib/ai/schemas'
import {
  CONCEPT_DIFFICULTY_MAX,
  CONCEPT_DIFFICULTY_MIN,
  isValidConceptSlug,
} from '#/lib/concept-graph'

/** One edge's Concept Validation verdict (ADR-0016). */
export type EdgeValidationStatus = 'ok' | 'dangling' | 'cycle'

/** The deterministic Concept Validation verdict for one drafted graph. */
export type ConceptValidationResult = {
  /**
   * Drafts whose slugs are not well-formed or whose difficulty is out of
   * range. Such concepts can never be persisted as-is and are excluded from
   * use until corrected.
   */
  excludedConceptSlugs: string[]
  /** Per-edge verdict, keyed by {@link conceptEdgeKey}. */
  edgeStatuses: Map<string, EdgeValidationStatus>
}

/** Stable per-edge map key; slugs cannot contain the separator. */
export function conceptEdgeKey(edge: {
  from: string
  to: string
  kind: string
}): string {
  return `${edge.from}|${edge.to}|${edge.kind}`
}

/**
 * The deterministic Concept Validation gate (ADR-0016, CONTEXT.md — Concept
 * Validation): cycle detection on the prerequisite subgraph (it must be a
 * DAG) plus dangling-reference resolution (every edge endpoint must resolve
 * to a real concept). Runs against every drafted graph; a concept or edge
 * that fails is excluded from Class A/Class B use regardless of Review
 * Status, but stays visible in the review UI so it can be corrected.
 *
 * Verdicts:
 * - A concept is excluded when its draft is malformed (bad slug or out-of
 *   range difficulty).
 * - An edge is `dangling` when either endpoint is not a usable concept.
 * - An edge is `cycle` when it is a self-loop or when its prerequisite
 *   edge lies on a directed cycle (its target can reach its source through
 *   prerequisite edges). `related` edges never create cycles — the DAG
 *   requirement applies to prerequisites only (ADR-0016).
 * - Every other edge is `ok`.
 *
 * After removing all `cycle` and `dangling` edges, the remaining
 * prerequisite subgraph is guaranteed acyclic, so the "usable" projection
 * is always a DAG.
 */
export function validateConceptGraph(
  concepts: ConceptDraft[],
  edges: ConceptEdgeDraft[],
): ConceptValidationResult {
  const excludedConceptSlugs = new Set<string>()
  const usableSlugs = new Set<string>()
  for (const concept of concepts) {
    const usable =
      isValidConceptSlug(concept.slug) &&
      concept.difficulty >= CONCEPT_DIFFICULTY_MIN &&
      concept.difficulty <= CONCEPT_DIFFICULTY_MAX
    if (usable) {
      usableSlugs.add(concept.slug)
    } else {
      excludedConceptSlugs.add(concept.slug)
    }
  }

  const edgeStatuses = new Map<string, EdgeValidationStatus>()

  // First pass: self-loops (always cycle) and dangling references.
  const resolvedEdges: ConceptEdgeDraft[] = []
  for (const edge of edges) {
    const key = conceptEdgeKey(edge)
    if (edge.from === edge.to) {
      edgeStatuses.set(key, 'cycle')
      continue
    }
    if (!usableSlugs.has(edge.from) || !usableSlugs.has(edge.to)) {
      edgeStatuses.set(key, 'dangling')
      continue
    }
    resolvedEdges.push(edge)
  }

  // Second pass: cycle detection over the resolved prerequisite subgraph.
  // An edge (u -> v) lies on a cycle exactly when v can reach u again.
  const prerequisiteSuccessors = new Map<string, string[]>()
  for (const edge of resolvedEdges) {
    if (edge.kind !== 'prerequisite') continue
    const successors = prerequisiteSuccessors.get(edge.from) ?? []
    successors.push(edge.to)
    prerequisiteSuccessors.set(edge.from, successors)
  }

  for (const edge of resolvedEdges) {
    if (edge.kind !== 'prerequisite') continue
    if (canReach(edge.to, edge.from, prerequisiteSuccessors)) {
      edgeStatuses.set(conceptEdgeKey(edge), 'cycle')
    }
  }

  for (const edge of edges) {
    const key = conceptEdgeKey(edge)
    if (!edgeStatuses.has(key)) {
      edgeStatuses.set(key, 'ok')
    }
  }

  return {
    excludedConceptSlugs: [...excludedConceptSlugs],
    edgeStatuses,
  }
}

/** Whether `target` is reachable from `start` via prerequisite edges. */
function canReach(
  start: string,
  target: string,
  successors: Map<string, string[]>,
): boolean {
  const visited = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    if (current === target) return true
    visited.add(current)
    for (const next of successors.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next)
    }
  }
  return false
}
