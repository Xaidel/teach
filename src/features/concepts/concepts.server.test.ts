import { inArray, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/ai/functions.server', () => ({
  draftConceptGraph: vi.fn(),
}))

import { db } from '#/db/client.server'
import { conceptEdges, concepts } from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { draftConceptGraph } from '#/lib/ai/functions.server'
import type {
  ConceptDraft,
  ConceptEdgeDraft,
  DraftConceptGraphOutput,
} from '#/lib/ai/schemas'

import { ConceptError } from './concepts.schema'
import type { UsableConceptGraph } from './concepts.schema'
import {
  addConceptEdge,
  draftConcepts,
  getConceptReview,
  getUsableConceptGraph,
  removeConceptEdge,
  setConceptStatus,
  updateConcept,
} from './concepts.server'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()
const draftConceptGraphMock = vi.mocked(draftConceptGraph)

/** Test-only slugs, namespaced so they never collide with real drafts. */
const TEST_SLUGS = [
  'test.graph.a',
  'test.graph.b',
  'test.graph.c',
  'test.graph.d',
  'test.graph.renamed',
  'Test Graph',
] as const

async function insertConcept(
  slug: string,
  difficulty = 3,
  status: 'draft' | 'approved' = 'draft',
): Promise<string> {
  const [row] = await db
    .insert(concepts)
    .values({ language: 'rust', slug, difficulty, status })
    .returning({ id: concepts.id })
  if (!row) throw new Error('concept insert returned no row')
  return row.id
}

async function insertEdge(
  fromConceptId: string,
  toConceptId: string,
  kind: 'prerequisite' | 'related',
): Promise<void> {
  await db.insert(conceptEdges).values({
    fromConceptId,
    toConceptId,
    kind,
  })
}

/**
 * The usable projection, scoped to this suite's own fixture slugs. Test
 * files run in parallel against one shared Postgres (issue #92), so a
 * whole-graph equality assertion would race other suites' rust fixtures.
 */
function filterUsableTo(
  usable: UsableConceptGraph,
  slugs: readonly string[],
): UsableConceptGraph {
  const slugSet = new Set(slugs)
  const fixtureConcepts = usable.concepts.filter((concept) =>
    slugSet.has(concept.slug),
  )
  const fixtureIds = new Set(fixtureConcepts.map((concept) => concept.id))
  return {
    language: usable.language,
    concepts: fixtureConcepts,
    edges: usable.edges.filter(
      (edge) =>
        fixtureIds.has(edge.fromConceptId) && fixtureIds.has(edge.toConceptId),
    ),
  }
}

afterEach(async () => {
  const testConceptIds = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(inArray(concepts.slug, [...TEST_SLUGS]))
  const ids = testConceptIds.map((row) => row.id)
  if (ids.length > 0) {
    await db
      .delete(conceptEdges)
      .where(
        sql`${conceptEdges.fromConceptId} in ${ids} or ${conceptEdges.toConceptId} in ${ids}`,
      )
    await db.delete(concepts).where(inArray(concepts.id, ids))
  }
  draftConceptGraphMock.mockReset()
})

describe.skipIf(!dbUp)('concept review reads against Postgres', () => {
  it('returns every concept with its edges and live validation verdicts', async () => {
    const aId = await insertConcept('test.graph.a')
    const bId = await insertConcept('test.graph.b', 4, 'approved')
    await insertEdge(aId, bId, 'prerequisite')

    const review = await getConceptReview('rust')

    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    const b = review.concepts.find((c) => c.slug === 'test.graph.b')

    expect(a).toBeDefined()
    expect(b?.status).toBe('approved')
    expect(b?.difficulty).toBe(4)
    const edge = a?.edges.find(
      (e) => e.toSlug === 'test.graph.b' && e.kind === 'prerequisite',
    )
    expect(edge?.validation).toBe('ok')
    expect(b?.edges.some((e) => e.fromSlug === 'test.graph.a')).toBe(true)
  })

  it('exposes validation-failing cycle edges in the review view', async () => {
    const aId = await insertConcept('test.graph.a')
    const bId = await insertConcept('test.graph.b')
    await insertEdge(aId, bId, 'prerequisite')
    await insertEdge(bId, aId, 'prerequisite')

    const review = await getConceptReview('rust')

    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    const cycleEdge = a?.edges.find(
      (e) => e.toSlug === 'test.graph.b' && e.kind === 'prerequisite',
    )
    expect(cycleEdge?.validation).toBe('cycle')
  })

  it('surfaces dangling edges in the review view when a concept is not usable', async () => {
    const aId = await insertConcept('test.graph.a')
    const badId = await insertConcept('Test Graph')
    await insertEdge(aId, badId, 'prerequisite')

    const review = await getConceptReview('rust')

    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    const danglingEdge = a?.edges.find(
      (e) => e.toSlug === 'Test Graph' && e.kind === 'prerequisite',
    )
    expect(danglingEdge?.validation).toBe('dangling')
  })
})

describe.skipIf(!dbUp)(
  'usable concept graph projection against Postgres',
  () => {
    it('returns draft-status concepts (review never gates use)', async () => {
      const aId = await insertConcept('test.graph.a', 2, 'draft')
      const bId = await insertConcept('test.graph.b', 3, 'approved')
      await insertEdge(aId, bId, 'prerequisite')

      const usable = filterUsableTo(await getUsableConceptGraph('rust'), [
        'test.graph.a',
        'test.graph.b',
      ])

      expect(usable.concepts.map((c) => c.slug).sort()).toEqual([
        'test.graph.a',
        'test.graph.b',
      ])
      expect(usable.edges.some((e) => e.kind === 'prerequisite')).toBe(true)
    })

    it('excludes validation-failing edges regardless of review status', async () => {
      const aId = await insertConcept('test.graph.a', 2, 'approved')
      const bId = await insertConcept('test.graph.b', 3, 'draft')
      await insertEdge(aId, bId, 'prerequisite')
      await insertEdge(bId, aId, 'prerequisite')

      const usable = filterUsableTo(await getUsableConceptGraph('rust'), [
        'test.graph.a',
        'test.graph.b',
      ])

      expect(usable.concepts.map((c) => c.slug).sort()).toEqual([
        'test.graph.a',
        'test.graph.b',
      ])
      expect(usable.edges).toEqual([])
    })

    it('excludes dangling edges from use when a concept is not usable', async () => {
      const aId = await insertConcept('test.graph.a')
      const badId = await insertConcept('Test Graph')
      await insertEdge(aId, badId, 'prerequisite')

      const usable = filterUsableTo(await getUsableConceptGraph('rust'), [
        'test.graph.a',
        'Test Graph',
      ])

      expect(usable.concepts.map((c) => c.slug).sort()).toEqual([
        'test.graph.a',
      ])
      expect(usable.edges).toEqual([])
    })

    it('keeps non-cycle prerequisite edges usable when only one edge of a cycle is removable', async () => {
      const aId = await insertConcept('test.graph.a')
      const bId = await insertConcept('test.graph.b')
      const cId = await insertConcept('test.graph.c')
      await insertEdge(aId, bId, 'prerequisite')
      await insertEdge(bId, cId, 'prerequisite')
      await insertEdge(cId, bId, 'prerequisite')

      const usable = filterUsableTo(await getUsableConceptGraph('rust'), [
        'test.graph.a',
        'test.graph.b',
        'test.graph.c',
      ])

      expect(usable.edges).toHaveLength(1)
      expect(usable.edges[0]?.kind).toBe('prerequisite')
    })
  },
)

describe.skipIf(!dbUp)('draftConcepts against Postgres', () => {
  const DRAFTED: ConceptDraft[] = [
    { slug: 'test.graph.a', difficulty: 2 },
    { slug: 'test.graph.b', difficulty: 3 },
    { slug: 'test.graph.c', difficulty: 4 },
  ]

  function draftWith(edges: ConceptEdgeDraft[]): DraftConceptGraphOutput {
    return { concepts: DRAFTED, edges }
  }

  beforeEach(() => {
    draftConceptGraphMock.mockResolvedValue(
      draftWith([
        { from: 'test.graph.a', to: 'test.graph.b', kind: 'prerequisite' },
        { from: 'test.graph.a', to: 'test.graph.c', kind: 'related' },
      ]),
    )
  })

  it('persists every drafted concept as draft with its edges', async () => {
    const output = await draftConcepts('rust')

    expect(output.conceptsInserted).toBe(3)
    expect(output.edgesInserted).toBe(2)
    expect(output.duplicateConcepts).toBe(0)
    expect(output.duplicateEdges).toBe(0)
    expect(output.cycleEdges).toEqual([])
    expect(output.droppedSelfLoops).toEqual([])
    expect(output.droppedDanglingEdges).toEqual([])

    const review = await getConceptReview('rust')
    const slugs = review.concepts.map((c) => c.slug)
    expect(slugs).toContain('test.graph.a')
    expect(slugs).toContain('test.graph.b')
    expect(slugs).toContain('test.graph.c')
    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    expect(a?.status).toBe('draft')
    expect(a?.edges.map((e) => `${e.toSlug}:${e.kind}`).sort()).toEqual([
      'test.graph.b:prerequisite',
      'test.graph.c:related',
    ])
  })

  it('persists cycle edges but reports and excludes them from use', async () => {
    draftConceptGraphMock.mockResolvedValue(
      draftWith([
        { from: 'test.graph.a', to: 'test.graph.b', kind: 'prerequisite' },
        { from: 'test.graph.b', to: 'test.graph.a', kind: 'prerequisite' },
      ]),
    )

    const output = await draftConcepts('rust')

    expect(output.edgesInserted).toBe(2)
    expect(output.cycleEdges).toEqual([
      { from: 'test.graph.a', to: 'test.graph.b', kind: 'prerequisite' },
      { from: 'test.graph.b', to: 'test.graph.a', kind: 'prerequisite' },
    ])

    const review = await getConceptReview('rust')
    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    expect(a?.edges.map((e) => e.validation)).toEqual(['cycle', 'cycle'])

    const usable = await getUsableConceptGraph('rust')
    expect(usable.edges).toEqual([])
  })

  it('drops and reports dangling edges and self-loops without persisting them', async () => {
    draftConceptGraphMock.mockResolvedValue(
      draftWith([
        { from: 'test.graph.a', to: 'test.graph.b', kind: 'prerequisite' },
        {
          from: 'test.graph.a',
          to: 'test.graph.missing',
          kind: 'prerequisite',
        },
        { from: 'test.graph.b', to: 'test.graph.b', kind: 'related' },
      ]),
    )

    const output = await draftConcepts('rust')

    expect(output.edgesInserted).toBe(1)
    expect(output.droppedDanglingEdges).toEqual([
      { from: 'test.graph.a', to: 'test.graph.missing', kind: 'prerequisite' },
    ])
    expect(output.droppedSelfLoops).toEqual([
      { from: 'test.graph.b', to: 'test.graph.b', kind: 'related' },
    ])

    const review = await getConceptReview('rust')
    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    expect(a?.edges).toHaveLength(1)
  })

  it('is idempotent across repeated drafts of the same graph', async () => {
    const first = await draftConcepts('rust')
    const second = await draftConcepts('rust')

    expect(second.conceptsInserted).toBe(0)
    expect(second.edgesInserted).toBe(0)
    expect(second.duplicateConcepts).toBe(first.conceptsInserted)
    expect(second.duplicateEdges).toBe(first.edgesInserted)

    const usable = filterUsableTo(await getUsableConceptGraph('rust'), [
      'test.graph.a',
      'test.graph.b',
      'test.graph.c',
    ])
    expect(usable.concepts).toHaveLength(3)
    expect(usable.edges).toHaveLength(2)
  })

  it('maps a Teacher Engine failure to the stable draft-failed error', async () => {
    draftConceptGraphMock.mockRejectedValue(
      new TeacherEngineError('api_error', 'API unreachable'),
    )

    await expect(draftConcepts('rust')).rejects.toBeInstanceOf(ConceptError)
    await expect(draftConcepts('rust')).rejects.toMatchObject({
      code: 'CONCEPT_DRAFT_FAILED',
    })
  })
})

describe.skipIf(!dbUp)('concept review mutations against Postgres', () => {
  it('marks a concept approved and back to draft', async () => {
    const aId = await insertConcept('test.graph.a')

    await setConceptStatus({ conceptId: aId, status: 'approved' })

    const review = await getConceptReview('rust')
    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    expect(a?.status).toBe('approved')

    await setConceptStatus({ conceptId: aId, status: 'draft' })
    const after = await getConceptReview('rust')
    expect(after.concepts.find((c) => c.slug === 'test.graph.a')?.status).toBe(
      'draft',
    )
  })

  it('rejects status changes for unknown concepts', async () => {
    await expect(
      setConceptStatus({
        conceptId: '00000000-0000-7000-8000-000000000000',
        status: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_NOT_FOUND' })
  })

  it('renames a concept slug without touching its edges', async () => {
    const aId = await insertConcept('test.graph.a')
    const bId = await insertConcept('test.graph.b')
    await insertEdge(aId, bId, 'prerequisite')

    await updateConcept({
      conceptId: aId,
      slug: 'test.graph.renamed',
      difficulty: 5,
    })

    const review = await getConceptReview('rust')
    const renamed = review.concepts.find((c) => c.slug === 'test.graph.renamed')
    expect(renamed?.difficulty).toBe(5)
    const b = review.concepts.find((c) => c.slug === 'test.graph.b')
    expect(b?.edges[0]?.fromSlug).toBe('test.graph.renamed')
  })

  it('rejects a slug rename that collides within the language', async () => {
    const aId = await insertConcept('test.graph.a')
    await insertConcept('test.graph.b')

    await expect(
      updateConcept({ conceptId: aId, slug: 'test.graph.b', difficulty: 3 }),
    ).rejects.toMatchObject({ code: 'CONCEPT_SLUG_TAKEN' })
  })

  it('rejects updates for unknown concepts', async () => {
    await expect(
      updateConcept({
        conceptId: '00000000-0000-7000-8000-000000000000',
        slug: 'test.graph.a',
        difficulty: 3,
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_NOT_FOUND' })
  })

  it('adds an edge to an existing concept in the same language', async () => {
    const aId = await insertConcept('test.graph.a')
    await insertConcept('test.graph.b')

    await addConceptEdge({
      fromConceptId: aId,
      toSlug: 'test.graph.b',
      kind: 'related',
    })

    const review = await getConceptReview('rust')
    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    expect(
      a?.edges.some((e) => e.toSlug === 'test.graph.b' && e.kind === 'related'),
    ).toBe(true)
  })

  it('rejects edges to a missing or foreign-language target', async () => {
    const aId = await insertConcept('test.graph.a')

    await expect(
      addConceptEdge({
        fromConceptId: aId,
        toSlug: 'test.graph.missing',
        kind: 'prerequisite',
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_EDGE_TARGET_NOT_FOUND' })
  })

  it('rejects self-loops and duplicate edges', async () => {
    const aId = await insertConcept('test.graph.a')
    await insertConcept('test.graph.b')

    await expect(
      addConceptEdge({
        fromConceptId: aId,
        toSlug: 'test.graph.a',
        kind: 'related',
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_EDGE_SELF_LOOP' })

    await addConceptEdge({
      fromConceptId: aId,
      toSlug: 'test.graph.b',
      kind: 'related',
    })
    await expect(
      addConceptEdge({
        fromConceptId: aId,
        toSlug: 'test.graph.b',
        kind: 'related',
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_EDGE_CONFLICT' })
  })

  it('removes an edge and rejects removal of unknown edges', async () => {
    const aId = await insertConcept('test.graph.a')
    const bId = await insertConcept('test.graph.b')
    await insertEdge(aId, bId, 'prerequisite')

    await removeConceptEdge({
      fromConceptId: aId,
      toConceptId: bId,
      kind: 'prerequisite',
    })

    const review = await getConceptReview('rust')
    const a = review.concepts.find((c) => c.slug === 'test.graph.a')
    expect(a?.edges).toHaveLength(0)

    await expect(
      removeConceptEdge({
        fromConceptId: aId,
        toConceptId: bId,
        kind: 'prerequisite',
      }),
    ).rejects.toMatchObject({ code: 'CONCEPT_EDGE_NOT_FOUND' })
  })
})
