import type { Edge } from '@xyflow/react'
import { useEffect, useState } from 'react'

import type { ConceptFlowNode } from './concept-graph-layout'
import { layoutConceptGraph } from './concept-graph-layout'
import type { CurriculumStep } from './curriculum.schema'

/** The ELK-computed graph for one Class A sequence, plus whether layout
 * is still running (ELK is async even though it resolves quickly). */
export type ConceptGraphState = {
  nodes: ConceptFlowNode[]
  edges: Edge[]
  isLayingOut: boolean
}

/**
 * Runs ELK layout for a Class A sequence and keeps the result in state.
 * Layout is recomputed whenever `steps` changes identity (a fresh loader
 * read); a stale in-flight layout from a superseded `steps` value is
 * discarded rather than applied.
 */
export function useConceptGraph(
  steps: readonly CurriculumStep[],
): ConceptGraphState {
  const [graph, setGraph] = useState<{
    nodes: ConceptFlowNode[]
    edges: Edge[]
  }>({ nodes: [], edges: [] })
  const [isLayingOut, setIsLayingOut] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLayingOut(true)

    layoutConceptGraph(steps)
      .then((result) => {
        if (!cancelled) {
          setGraph(result)
          setIsLayingOut(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLayingOut(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [steps])

  return { nodes: graph.nodes, edges: graph.edges, isLayingOut }
}
