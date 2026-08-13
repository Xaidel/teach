import { describe, expect, it } from 'vitest'

import type { UsableConceptGraph } from '../concepts/concepts.schema'
import { orderCurriculum } from './curriculum-order'

/** A graph builder: ids map to slugs; edges reference ids. */
function graph(
  concepts: { id: string; slug: string }[],
  edges: {
    fromConceptId: string
    toConceptId: string
    kind: 'prerequisite' | 'related'
  }[],
): UsableConceptGraph {
  return {
    language: 'rust',
    concepts: concepts.map((c) => ({ id: c.id, slug: c.slug, difficulty: 1 })),
    edges,
  }
}

const C = (id: string, slug: string) => ({ id, slug })

describe('orderCurriculum', () => {
  it('orders a chain by prerequisites', () => {
    const g = graph(
      [C('a', 'rust.alpha'), C('b', 'rust.beta'), C('c', 'rust.gamma')],
      [
        { fromConceptId: 'a', toConceptId: 'b', kind: 'prerequisite' },
        { fromConceptId: 'b', toConceptId: 'c', kind: 'prerequisite' },
      ],
    )

    expect(orderCurriculum(g).map((entry) => entry.slug)).toEqual([
      'rust.alpha',
      'rust.beta',
      'rust.gamma',
    ])
  })

  it('orders a diamond with the shared prerequisite first', () => {
    const g = graph(
      [
        C('a', 'rust.root'),
        C('b', 'rust.left'),
        C('c', 'rust.right'),
        C('d', 'rust.leaf'),
      ],
      [
        { fromConceptId: 'a', toConceptId: 'b', kind: 'prerequisite' },
        { fromConceptId: 'a', toConceptId: 'c', kind: 'prerequisite' },
        { fromConceptId: 'b', toConceptId: 'd', kind: 'prerequisite' },
        { fromConceptId: 'c', toConceptId: 'd', kind: 'prerequisite' },
      ],
    )

    const slugs = orderCurriculum(g).map((entry) => entry.slug)
    expect(slugs.indexOf('rust.root')).toBeLessThan(slugs.indexOf('rust.left'))
    expect(slugs.indexOf('rust.root')).toBeLessThan(slugs.indexOf('rust.right'))
    expect(slugs.indexOf('rust.left')).toBeLessThan(slugs.indexOf('rust.leaf'))
    expect(slugs.indexOf('rust.right')).toBeLessThan(slugs.indexOf('rust.leaf'))
  })

  it('places concepts without prerequisites first, in slug order', () => {
    const g = graph(
      [C('a', 'rust.zeta'), C('b', 'rust.alpha'), C('c', 'rust.beta')],
      [],
    )

    expect(orderCurriculum(g).map((entry) => entry.slug)).toEqual([
      'rust.alpha',
      'rust.beta',
      'rust.zeta',
    ])
  })

  it('breaks same-level candidates deterministically by slug', () => {
    const g = graph(
      [
        C('a', 'rust.zeta'),
        C('b', 'rust.alpha'),
        C('c', 'rust.beta'),
        C('d', 'rust.leaf'),
      ],
      [
        { fromConceptId: 'a', toConceptId: 'd', kind: 'prerequisite' },
        { fromConceptId: 'b', toConceptId: 'd', kind: 'prerequisite' },
        { fromConceptId: 'c', toConceptId: 'd', kind: 'prerequisite' },
      ],
    )

    const first = orderCurriculum(g).map((entry) => entry.slug)
    // Same input twice → same output: the tie-break is stable.
    expect(first).toEqual(orderCurriculum(g).map((entry) => entry.slug))
    // Candidates at the same level appear in slug order.
    expect(first.indexOf('rust.alpha')).toBeLessThan(first.indexOf('rust.beta'))
    expect(first.indexOf('rust.beta')).toBeLessThan(first.indexOf('rust.zeta'))
  })

  it('ignores related edges entirely', () => {
    const g = graph(
      [C('a', 'rust.a'), C('b', 'rust.b'), C('c', 'rust.c')],
      [
        { fromConceptId: 'c', toConceptId: 'a', kind: 'related' },
        { fromConceptId: 'b', toConceptId: 'a', kind: 'prerequisite' },
      ],
    )

    const slugs = orderCurriculum(g).map((entry) => entry.slug)
    expect(slugs.indexOf('rust.b')).toBeLessThan(slugs.indexOf('rust.a'))
    // The related edge c→a would, if honored, force c before a — it must
    // not: a precedes c by slug order alone.
    expect(slugs.indexOf('rust.a')).toBeLessThan(slugs.indexOf('rust.c'))
  })

  it('never drops concepts, even from a cyclic remainder', () => {
    const g = graph(
      [C('a', 'rust.alpha'), C('b', 'rust.beta'), C('c', 'rust.gamma')],
      [
        { fromConceptId: 'a', toConceptId: 'b', kind: 'prerequisite' },
        { fromConceptId: 'b', toConceptId: 'a', kind: 'prerequisite' },
        { fromConceptId: 'b', toConceptId: 'c', kind: 'prerequisite' },
      ],
    )

    const slugs = orderCurriculum(g).map((entry) => entry.slug)
    expect(new Set(slugs)).toEqual(
      new Set(['rust.alpha', 'rust.beta', 'rust.gamma']),
    )
    expect(slugs.length).toBe(3)
  })
})
