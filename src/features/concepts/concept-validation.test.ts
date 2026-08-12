import { describe, expect, it } from 'vitest'

import type { ConceptDraft, ConceptEdgeDraft } from '#/lib/ai/schemas'

import { conceptEdgeKey, validateConceptGraph } from './concept-validation'

function draft(slug: string, difficulty = 3): ConceptDraft {
  return { slug, difficulty }
}

function edge(
  from: string,
  to: string,
  kind: ConceptEdgeDraft['kind'] = 'prerequisite',
): ConceptEdgeDraft {
  return { from, to, kind }
}

function statusOf(
  result: ReturnType<typeof validateConceptGraph>,
  e: ConceptEdgeDraft,
): string {
  return result.edgeStatuses.get(conceptEdgeKey(e)) ?? 'missing'
}

describe('validateConceptGraph', () => {
  it('passes a known-good DAG: every concept usable, every edge ok', () => {
    const concepts = [
      draft('rust.ownership'),
      draft('rust.borrowing'),
      draft('rust.lifetimes'),
    ]
    const edges = [
      edge('rust.ownership', 'rust.borrowing'),
      edge('rust.borrowing', 'rust.lifetimes'),
      edge('rust.ownership', 'rust.lifetimes'),
      edge('rust.ownership', 'rust.lifetimes', 'related'),
    ]

    const result = validateConceptGraph(concepts, edges)

    expect(result.excludedConceptSlugs).toEqual([])
    for (const e of edges) {
      expect(statusOf(result, e)).toBe('ok')
    }
  })

  it('flags every edge of a two-node prerequisite cycle as cycle', () => {
    const edges = [edge('rust.a', 'rust.b'), edge('rust.b', 'rust.a')]

    const result = validateConceptGraph(
      [draft('rust.a'), draft('rust.b')],
      edges,
    )

    expect(
      statusOf(result, edges[0] ?? { from: '', to: '', kind: 'prerequisite' }),
    ).toBe('cycle')
    expect(
      statusOf(result, edges[1] ?? { from: '', to: '', kind: 'prerequisite' }),
    ).toBe('cycle')
  })

  it('flags every edge of a three-node cycle while leaving off-cycle edges ok', () => {
    const concepts = [
      draft('rust.a'),
      draft('rust.b'),
      draft('rust.c'),
      draft('rust.d'),
    ]
    const edges = [
      edge('rust.a', 'rust.b'),
      edge('rust.b', 'rust.c'),
      edge('rust.c', 'rust.a'),
      edge('rust.d', 'rust.a'),
    ]

    const result = validateConceptGraph(concepts, edges)

    expect(statusOf(result, edges[0] ?? edge('', ''))).toBe('cycle')
    expect(statusOf(result, edges[1] ?? edge('', ''))).toBe('cycle')
    expect(statusOf(result, edges[2] ?? edge('', ''))).toBe('cycle')
    expect(statusOf(result, edges[3] ?? edge('', ''))).toBe('ok')
  })

  it('flags a self-loop as cycle regardless of kind', () => {
    const result = validateConceptGraph(
      [draft('rust.a')],
      [edge('rust.a', 'rust.a'), edge('rust.a', 'rust.a', 'related')],
    )

    expect(statusOf(result, edge('rust.a', 'rust.a'))).toBe('cycle')
    expect(statusOf(result, edge('rust.a', 'rust.a', 'related'))).toBe('cycle')
  })

  it('flags edges with missing endpoints as dangling', () => {
    const result = validateConceptGraph(
      [draft('rust.a')],
      [edge('rust.a', 'rust.missing'), edge('rust.missing', 'rust.a')],
    )

    expect(statusOf(result, edge('rust.a', 'rust.missing'))).toBe('dangling')
    expect(statusOf(result, edge('rust.missing', 'rust.a'))).toBe('dangling')
  })

  it('excludes malformed concepts and treats edges to them as dangling', () => {
    const result = validateConceptGraph(
      [draft('rust.a'), draft('Invalid Slug'), draft('rust.bad', 9)],
      [edge('rust.a', 'Invalid Slug'), edge('rust.a', 'rust.bad')],
    )

    expect(result.excludedConceptSlugs.sort()).toEqual([
      'Invalid Slug',
      'rust.bad',
    ])
    expect(statusOf(result, edge('rust.a', 'Invalid Slug'))).toBe('dangling')
    expect(statusOf(result, edge('rust.a', 'rust.bad'))).toBe('dangling')
  })

  it('never treats related edges as cycle-forming', () => {
    const edges = [
      edge('rust.a', 'rust.b', 'related'),
      edge('rust.b', 'rust.a', 'related'),
    ]

    const result = validateConceptGraph(
      [draft('rust.a'), draft('rust.b')],
      edges,
    )

    expect(statusOf(result, edges[0] ?? edge('', ''))).toBe('ok')
    expect(statusOf(result, edges[1] ?? edge('', ''))).toBe('ok')
  })

  it('ignores dangling edges when detecting cycles', () => {
    const edges = [edge('rust.a', 'rust.b'), edge('rust.b', 'rust.missing')]

    const result = validateConceptGraph(
      [draft('rust.a'), draft('rust.b')],
      edges,
    )

    expect(statusOf(result, edges[0] ?? edge('', ''))).toBe('ok')
    expect(statusOf(result, edges[1] ?? edge('', ''))).toBe('dangling')
  })

  it('produces edge keys that are stable and collision-free', () => {
    expect(
      conceptEdgeKey({ from: 'rust.a', to: 'rust.b', kind: 'prerequisite' }),
    ).toBe('rust.a|rust.b|prerequisite')
    expect(
      conceptEdgeKey({ from: 'rust.a', to: 'rust.b', kind: 'prerequisite' }),
    ).not.toBe(
      conceptEdgeKey({ from: 'rust.b', to: 'rust.a', kind: 'prerequisite' }),
    )
    expect(
      conceptEdgeKey({ from: 'rust.a', to: 'rust.b', kind: 'prerequisite' }),
    ).not.toBe(
      conceptEdgeKey({ from: 'rust.a', to: 'rust.b', kind: 'related' }),
    )
  })

  it('marks an empty graph as fully valid', () => {
    const result = validateConceptGraph([], [])
    expect(result.excludedConceptSlugs).toEqual([])
    expect(result.edgeStatuses.size).toBe(0)
  })
})
