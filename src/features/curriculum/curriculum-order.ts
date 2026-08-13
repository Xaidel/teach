import type { UsableConceptGraph } from '../concepts/concepts.schema'

/**
 * One concept in the ordered Class A sequence, identified by the stable
 * Concept Graph key (id) and its readable slug.
 */
export type OrderedConcept = {
  conceptId: string
  slug: string
}

/**
 * Orders a usable Concept Graph's concepts into the Class A curriculum
 * sequence (SPEC story 1): a stable topological sort over the `prerequisite`
 * edges, so a concept never precedes one of its prerequisites. The input is
 * the Concept-Validation-passing projection (a DAG on prerequisites, ADR-0016),
 * so a full order always exists; as a defense in depth the sort never
 * silently drops concepts — a residual (cyclic) remainder is appended in
 * slug order rather than thrown away.
 *
 * Determinism: when several concepts are simultaneously free of unplaced
 * prerequisites (a fan-in level), the smallest slug is placed first, so the
 * sequence is reproducible from the same graph and unrelated concepts
 * cannot shuffle between reads. `related` edges never participate in the
 * ordering — only `prerequisite` edges do.
 */
export function orderCurriculum(graph: UsableConceptGraph): OrderedConcept[] {
  const conceptsById = new Map(graph.concepts.map((c) => [c.id, c]))
  const prerequisitesByConcept = new Map<string, string[]>()

  for (const concept of graph.concepts) {
    prerequisitesByConcept.set(concept.id, [])
  }
  for (const edge of graph.edges) {
    if (edge.kind !== 'prerequisite') continue
    prerequisitesByConcept.get(edge.toConceptId)?.push(edge.fromConceptId)
  }

  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const [conceptId, prerequisites] of prerequisitesByConcept) {
    inDegree.set(conceptId, prerequisites.length)
    for (const prerequisiteId of prerequisites) {
      const list = dependents.get(prerequisiteId) ?? []
      list.push(conceptId)
      dependents.set(prerequisiteId, list)
    }
  }

  const free = graph.concepts
    .filter((concept) => (inDegree.get(concept.id) ?? 0) === 0)
    .sort((a, b) => a.slug.localeCompare(b.slug))

  const ordered: OrderedConcept[] = []
  while (free.length > 0) {
    const next = free.shift()
    if (!next) break
    ordered.push({ conceptId: next.id, slug: next.slug })

    for (const dependentId of dependents.get(next.id) ?? []) {
      const remaining = (inDegree.get(dependentId) ?? 1) - 1
      inDegree.set(dependentId, remaining)
      if (remaining === 0) {
        const dependent = conceptsById.get(dependentId)
        if (dependent) {
          const index = free.findIndex((c) => c.slug > dependent.slug)
          free.splice(index === -1 ? free.length : index, 0, dependent)
        }
      }
    }
  }

  if (ordered.length < graph.concepts.length) {
    const placed = new Set(ordered.map((entry) => entry.conceptId))
    const remainder = graph.concepts
      .filter((concept) => !placed.has(concept.id))
      .sort((a, b) => a.slug.localeCompare(b.slug))
    for (const concept of remainder) {
      ordered.push({ conceptId: concept.id, slug: concept.slug })
    }
  }

  return ordered
}
