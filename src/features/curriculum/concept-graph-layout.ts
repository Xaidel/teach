import type { Edge, Node } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'

import type { CurriculumStep, CurriculumStepStatus } from './curriculum.schema'

/** Fixed node box size — told to ELK so it reserves exactly this much
 * space, and rendered at the same size by ConceptFlowNode so edges land
 * on the box's actual edges. */
export const CONCEPT_NODE_WIDTH = 200
export const CONCEPT_NODE_HEIGHT = 96

/** The concept data a graph node carries; ConceptFlowNode reads this to
 * render the four visual states (complete/started/available/locked). */
export type ConceptNodeData = {
  slug: string
  difficulty: number
  status: CurriculumStepStatus
  mastery: CurriculumStep['mastery']
  prerequisiteSlugs: string[]
}

export type ConceptFlowNode = Node<ConceptNodeData, 'concept'>

const elk = new ELK()

/**
 * ELK's layered algorithm: top-down layers by prerequisite depth, with
 * crossing minimization and node placement tuned to keep the graph
 * readable rather than just topologically valid.
 */
const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.nodeNode': '32',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
}

/**
 * Lays out a Class A sequence as a React Flow graph (ConceptGraph.dc.html):
 * ELK computes layer assignment, ordering, and crossing-minimized
 * positions from the prerequisite edges; this only shapes the ELK input
 * from `CurriculumStep`s and reads the resulting positions back into
 * React Flow's node/edge shape.
 */
export async function layoutConceptGraph(
  steps: readonly CurriculumStep[],
): Promise<{ nodes: ConceptFlowNode[]; edges: Edge[] }> {
  const elkEdges = steps.flatMap((step) =>
    step.prerequisites.map((prerequisite) => ({
      id: `${prerequisite.id}->${step.concept.id}`,
      sources: [prerequisite.id],
      targets: [step.concept.id],
    })),
  )

  const result = await elk.layout({
    id: 'concept-graph',
    layoutOptions: LAYOUT_OPTIONS,
    children: steps.map((step) => ({
      id: step.concept.id,
      width: CONCEPT_NODE_WIDTH,
      height: CONCEPT_NODE_HEIGHT,
    })),
    edges: elkEdges,
  })

  const positionByConceptId = new Map(
    (result.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ]),
  )

  const nodes: ConceptFlowNode[] = steps.map((step) => ({
    id: step.concept.id,
    type: 'concept',
    position: positionByConceptId.get(step.concept.id) ?? { x: 0, y: 0 },
    width: CONCEPT_NODE_WIDTH,
    height: CONCEPT_NODE_HEIGHT,
    draggable: false,
    connectable: false,
    data: {
      slug: step.concept.slug,
      difficulty: step.concept.difficulty,
      status: step.status,
      mastery: step.mastery,
      prerequisiteSlugs: step.prerequisites.map((p) => p.slug),
    },
  }))

  const edges: Edge[] = elkEdges.map((elkEdge) => ({
    id: elkEdge.id,
    source: elkEdge.sources[0] ?? '',
    target: elkEdge.targets[0] ?? '',
    type: 'smoothstep',
    style: { stroke: 'var(--border)', strokeWidth: 2 },
  }))

  return { nodes, edges }
}
