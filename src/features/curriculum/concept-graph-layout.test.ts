import { describe, expect, it } from 'vitest'

import type { CurriculumStep } from './curriculum.schema'
import {
  CONCEPT_NODE_HEIGHT,
  CONCEPT_NODE_WIDTH,
  layoutConceptGraph,
} from './concept-graph-layout'

function step(
  conceptId: string,
  slug: string,
  prerequisites: { id: string; slug: string }[],
  overrides: Partial<Pick<CurriculumStep, 'status' | 'mastery'>> = {},
): CurriculumStep {
  return {
    position: 1,
    concept: { id: conceptId, slug, difficulty: 2 },
    prerequisites,
    mastery: overrides.mastery ?? 'unknown',
    status: overrides.status ?? 'available',
  }
}

describe('layoutConceptGraph', () => {
  it('returns no nodes or edges for an empty sequence', async () => {
    const layout = await layoutConceptGraph([])

    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
  })

  it('sizes and types a single root node, with no edges', async () => {
    const layout = await layoutConceptGraph([step('a', 'rust.root', [])])

    expect(layout.nodes).toHaveLength(1)
    expect(layout.nodes[0]?.type).toBe('concept')
    expect(layout.nodes[0]?.width).toBe(CONCEPT_NODE_WIDTH)
    expect(layout.nodes[0]?.height).toBe(CONCEPT_NODE_HEIGHT)
    expect(layout.edges).toEqual([])
  })

  it('layers a diamond by prerequisite depth: root above its two children, both above the shared leaf', async () => {
    const root = step('a', 'rust.root', [])
    const left = step('b', 'rust.left', [{ id: 'a', slug: 'rust.root' }])
    const right = step('c', 'rust.right', [{ id: 'a', slug: 'rust.root' }])
    const leaf = step('d', 'rust.leaf', [
      { id: 'b', slug: 'rust.left' },
      { id: 'c', slug: 'rust.right' },
    ])
    const layout = await layoutConceptGraph([root, left, right, leaf])

    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    const rootY = byId.get('a')?.position.y ?? 0
    const leftY = byId.get('b')?.position.y ?? 0
    const rightY = byId.get('c')?.position.y ?? 0
    const leafY = byId.get('d')?.position.y ?? 0

    expect(rootY).toBeLessThan(leftY)
    expect(rootY).toBeLessThan(rightY)
    expect(leftY).toBeLessThan(leafY)
    expect(rightY).toBe(leftY)

    // Same-row siblings don't overlap horizontally.
    expect(byId.get('b')?.position.x).not.toBe(byId.get('c')?.position.x)

    // One edge per prerequisite relationship: root→left, root→right,
    // left→leaf, right→leaf.
    expect(layout.edges).toHaveLength(4)
    expect(
      new Set(layout.edges.map((e) => `${e.source}->${e.target}`)),
    ).toEqual(new Set(['a->b', 'a->c', 'b->d', 'c->d']))
  })

  it('carries status, mastery, difficulty, and prerequisite slugs onto each node', async () => {
    const root = step('a', 'rust.root', [], {
      status: 'complete',
      mastery: 'practiced',
    })
    const child = step('b', 'rust.child', [{ id: 'a', slug: 'rust.root' }], {
      status: 'locked',
    })
    const layout = await layoutConceptGraph([root, child])

    const childNode = layout.nodes.find((n) => n.id === 'b')
    expect(childNode?.data.status).toBe('locked')
    expect(childNode?.data.prerequisiteSlugs).toEqual(['rust.root'])

    const rootNode = layout.nodes.find((n) => n.id === 'a')
    expect(rootNode?.data.status).toBe('complete')
    expect(rootNode?.data.mastery).toBe('practiced')
    expect(rootNode?.data.difficulty).toBe(2)
  })

  it('marks every node non-draggable and non-connectable — the graph is read-only', async () => {
    const layout = await layoutConceptGraph([step('a', 'rust.root', [])])

    expect(layout.nodes[0]?.draggable).toBe(false)
    expect(layout.nodes[0]?.connectable).toBe(false)
  })

  it('is deterministic for the same input', async () => {
    const steps = [
      step('a', 'rust.root', []),
      step('b', 'rust.left', [{ id: 'a', slug: 'rust.root' }]),
      step('c', 'rust.right', [{ id: 'a', slug: 'rust.root' }]),
    ]

    expect(await layoutConceptGraph(steps)).toEqual(
      await layoutConceptGraph(steps),
    )
  })
})
