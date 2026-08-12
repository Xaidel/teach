import { and, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  ConceptDraft,
  ConceptEdgeDraft,
  DraftConceptGraphOutput,
} from '#/lib/ai/schemas'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { draftConceptGraph } from '#/lib/ai/functions.server'
import type { ConceptEdgeKind } from '#/lib/concept-graph'
import { db } from '#/db/client.server'
import { conceptEdges, concepts } from '#/db/schema'

import { conceptEdgeKey, validateConceptGraph } from './concept-validation'
import { ConceptError } from './concepts.schema'
import type {
  Concept,
  ConceptEdgeView,
  ConceptReview,
  ConceptReviewItem,
  DraftConceptsOutput,
  SandboxLanguage,
  UsableConceptGraph,
} from './concepts.schema'

type ConceptRow = typeof concepts.$inferSelect
type EdgeRow = typeof conceptEdges.$inferSelect

/** One persisted edge joined with its endpoint slugs. */
type ResolvedEdgeRow = EdgeRow & {
  fromSlug: string
  toSlug: string
}

/** All concepts and edges of one language, with slug resolution. */
type LoadedGraph = {
  concepts: ConceptRow[]
  edges: ResolvedEdgeRow[]
}

/** Loads one language's full graph: all concepts and every edge touching them. */
async function loadConceptGraph(
  language: SandboxLanguage,
): Promise<LoadedGraph> {
  const fromConcept = alias(concepts, 'from_concept')
  const toConcept = alias(concepts, 'to_concept')
  const [conceptRows, edgeRows] = await Promise.all([
    db.select().from(concepts).where(eq(concepts.language, language)),
    db
      .select({
        fromConceptId: conceptEdges.fromConceptId,
        toConceptId: conceptEdges.toConceptId,
        kind: conceptEdges.kind,
        fromSlug: fromConcept.slug,
        toSlug: toConcept.slug,
      })
      .from(conceptEdges)
      .innerJoin(fromConcept, eq(conceptEdges.fromConceptId, fromConcept.id))
      .innerJoin(toConcept, eq(conceptEdges.toConceptId, toConcept.id)),
  ])

  return { concepts: conceptRows, edges: edgeRows }
}

/** The Concept Validation verdict per persisted edge, keyed by edge id pair. */
function buildEdgeValidation(loaded: LoadedGraph): Map<string, 'ok' | 'cycle'> {
  const drafts: ConceptDraft[] = loaded.concepts.map((row) => ({
    slug: row.slug,
    difficulty: row.difficulty,
  }))
  const draftEdges: ConceptEdgeDraft[] = loaded.edges.map((row) => ({
    from: row.fromSlug,
    to: row.toSlug,
    kind: row.kind,
  }))
  const report = validateConceptGraph(drafts, draftEdges)
  return new Map(
    loaded.edges.map((row) => {
      const key = conceptEdgeKey({
        from: row.fromSlug,
        to: row.toSlug,
        kind: row.kind,
      })
      return [key, report.edgeStatuses.get(key) === 'cycle' ? 'cycle' : 'ok']
    }),
  )
}

/**
 * The in-app review view for one language (ADR-0016): every concept with
 * its Review Status, every edge with its live Concept Validation verdict,
 * so the reviewer can mark concepts approved and correct structural issues.
 * Failing concepts/edges stay visible here even though they are excluded
 * from Class A/Class B use.
 */
export async function getConceptReview(
  language: SandboxLanguage,
): Promise<ConceptReview> {
  const loaded = await loadConceptGraph(language)
  const validation = buildEdgeValidation(loaded)

  const reviewItems: ConceptReviewItem[] = loaded.concepts
    .map((row) => {
      const edges: ConceptEdgeView[] = loaded.edges
        .filter(
          (edge) =>
            edge.fromConceptId === row.id || edge.toConceptId === row.id,
        )
        .map((edge) => ({
          fromConceptId: edge.fromConceptId,
          toConceptId: edge.toConceptId,
          fromSlug: edge.fromSlug,
          toSlug: edge.toSlug,
          kind: edge.kind,
          validation:
            validation.get(
              conceptEdgeKey({
                from: edge.fromSlug,
                to: edge.toSlug,
                kind: edge.kind,
              }),
            ) ?? 'ok',
        }))
      const concept: Concept = {
        id: row.id,
        language: row.language as SandboxLanguage,
        slug: row.slug,
        difficulty: row.difficulty,
        status: row.status,
      }
      return { ...concept, edges }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug))

  return { language, concepts: reviewItems }
}

/**
 * The Class A/Class B projection of one language's graph: only concepts
 * and edges that pass the deterministic Concept Validation gate, with no
 * Review Status filter — `draft` and `approved` rows are both fully usable
 * (ADR-0016, CONTEXT.md — Concept Validation). The projection recomputes
 * validation at read time, so it can never drift from the tables.
 */
export async function getUsableConceptGraph(
  language: SandboxLanguage,
): Promise<UsableConceptGraph> {
  const loaded = await loadConceptGraph(language)
  const drafts: ConceptDraft[] = loaded.concepts.map((row) => ({
    slug: row.slug,
    difficulty: row.difficulty,
  }))
  const draftEdges: ConceptEdgeDraft[] = loaded.edges.map((row) => ({
    from: row.fromSlug,
    to: row.toSlug,
    kind: row.kind,
  }))
  const report = validateConceptGraph(drafts, draftEdges)

  const excluded = new Set(report.excludedConceptSlugs)
  const usableConcepts = loaded.concepts.filter(
    (row) => !excluded.has(row.slug),
  )
  const usableEdgeKeys = new Set(
    loaded.edges
      .filter(
        (row) =>
          report.edgeStatuses.get(
            conceptEdgeKey({
              from: row.fromSlug,
              to: row.toSlug,
              kind: row.kind,
            }),
          ) === 'ok',
      )
      .map((row) =>
        conceptEdgeKey({ from: row.fromSlug, to: row.toSlug, kind: row.kind }),
      ),
  )

  return {
    language,
    concepts: usableConcepts.map((row) => ({
      id: row.id,
      slug: row.slug,
      difficulty: row.difficulty,
    })),
    edges: loaded.edges
      .filter((row) =>
        usableEdgeKeys.has(
          conceptEdgeKey({
            from: row.fromSlug,
            to: row.toSlug,
            kind: row.kind,
          }),
        ),
      )
      .map((row) => ({
        fromConceptId: row.fromConceptId,
        toConceptId: row.toConceptId,
        kind: row.kind,
      })),
  }
}

/** Maps an edge draft to its persisted row, or null when it must be dropped. */
function isSelfLoop(edge: ConceptEdgeDraft): boolean {
  return edge.from === edge.to
}

/**
 * Drafts a broad initial Concept Graph for one language through the AI
 * Teacher Engine and persists it directly into the `concepts`/`concept_edges`
 * tables (ADR-0016): every drafted concept lands as `status: draft`; edges
 * with both endpoints present are persisted (cycle edges stay visible for
 * correction), while self-loops and dangling references are dropped and
 * reported. Every written row is covered by Concept Validation — failing
 * edges are persisted but excluded from Class A/Class B use regardless of
 * status. The model output is only raw material; it never decides usability.
 */
export async function draftConcepts(
  language: SandboxLanguage,
): Promise<DraftConceptsOutput> {
  let draft: DraftConceptGraphOutput
  try {
    draft = await draftConceptGraph({ language })
  } catch (error) {
    if (error instanceof TeacherEngineError) {
      throw new ConceptError('CONCEPT_DRAFT_FAILED')
    }
    throw error
  }

  const report = validateConceptGraph(draft.concepts, draft.edges)

  const result = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: concepts.id, slug: concepts.slug })
      .from(concepts)
      .where(
        and(
          eq(concepts.language, language),
          inArray(
            concepts.slug,
            draft.concepts.map((concept) => concept.slug),
          ),
        ),
      )
    const slugToId = new Map(existing.map((row) => [row.slug, row.id]))

    let conceptsInserted = 0
    for (const concept of draft.concepts) {
      const inserted = await tx
        .insert(concepts)
        .values({
          language,
          slug: concept.slug,
          difficulty: concept.difficulty,
        })
        .onConflictDoNothing({
          target: [concepts.language, concepts.slug],
        })
        .returning({ id: concepts.id })
      const row = inserted[0]
      if (row) {
        slugToId.set(concept.slug, row.id)
        conceptsInserted += 1
      }
    }

    let edgesInserted = 0
    let duplicates = 0
    const cycleEdges: ConceptEdgeDraft[] = []
    const droppedSelfLoops: ConceptEdgeDraft[] = []
    const droppedDanglingEdges: ConceptEdgeDraft[] = []
    for (const edge of draft.edges) {
      if (isSelfLoop(edge)) {
        droppedSelfLoops.push(edge)
        continue
      }
      const fromId = slugToId.get(edge.from)
      const toId = slugToId.get(edge.to)
      if (!fromId || !toId) {
        droppedDanglingEdges.push(edge)
        continue
      }
      const inserted = await tx
        .insert(conceptEdges)
        .values({
          fromConceptId: fromId,
          toConceptId: toId,
          kind: edge.kind,
        })
        .onConflictDoNothing({
          target: [
            conceptEdges.fromConceptId,
            conceptEdges.toConceptId,
            conceptEdges.kind,
          ],
        })
        .returning({ fromConceptId: conceptEdges.fromConceptId })
      if (inserted[0]) {
        edgesInserted += 1
      } else {
        duplicates += 1
      }
      if (report.edgeStatuses.get(conceptEdgeKey(edge)) === 'cycle') {
        cycleEdges.push(edge)
      }
    }

    return {
      conceptsInserted,
      edgesInserted,
      duplicateConcepts: draft.concepts.length - conceptsInserted,
      duplicateEdges: duplicates,
      cycleEdges,
      droppedSelfLoops,
      droppedDanglingEdges,
    }
  })

  return { language, ...result }
}

/** Marks a concept approved (or back to draft) through the review UI. */
export async function setConceptStatus(input: {
  conceptId: string
  status: 'draft' | 'approved'
}): Promise<{ conceptId: string; status: 'draft' | 'approved' }> {
  const updated = await db
    .update(concepts)
    .set({ status: input.status })
    .where(eq(concepts.id, input.conceptId))
    .returning({ id: concepts.id })
  if (!updated[0]) {
    throw new ConceptError('CONCEPT_NOT_FOUND')
  }
  return { conceptId: input.conceptId, status: input.status }
}

/** Whether a Postgres error is a unique-constraint violation (23505). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  if ('code' in error && (error as { code?: unknown }).code === '23505') {
    return true
  }
  if ('cause' in error) {
    return isUniqueViolation((error as { cause?: unknown }).cause)
  }
  return false
}

/**
 * Corrects a concept's slug or difficulty in review (structural review:
 * naming + plausible difficulty, ADR-0016). Slug renames are metadata-only
 * — edges reference concept ids, never slugs.
 */
export async function updateConcept(input: {
  conceptId: string
  slug: string
  difficulty: number
}): Promise<{ conceptId: string }> {
  try {
    const updated = await db
      .update(concepts)
      .set({ slug: input.slug, difficulty: input.difficulty })
      .where(eq(concepts.id, input.conceptId))
      .returning({ id: concepts.id })
    if (!updated[0]) {
      throw new ConceptError('CONCEPT_NOT_FOUND')
    }
    return { conceptId: input.conceptId }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConceptError('CONCEPT_SLUG_TAKEN')
    }
    throw error
  }
}

/**
 * Adds an edge during review (prerequisite sanity correction, ADR-0016).
 * The target is resolved by slug within the same language; duplicates and
 * self-loops are rejected. A newly added edge that forms a prerequisite
 * cycle is persisted — Concept Validation keeps it excluded from use until
 * the reviewer removes or reroutes it.
 */
export async function addConceptEdge(input: {
  fromConceptId: string
  toSlug: string
  kind: ConceptEdgeKind
}): Promise<{
  fromConceptId: string
  toConceptId: string
  kind: ConceptEdgeKind
}> {
  const fromConcept = await db.query.concepts.findFirst({
    where: eq(concepts.id, input.fromConceptId),
  })
  if (!fromConcept) {
    throw new ConceptError('CONCEPT_NOT_FOUND')
  }
  const toConcept = await db.query.concepts.findFirst({
    where: and(
      eq(concepts.slug, input.toSlug),
      eq(concepts.language, fromConcept.language),
    ),
  })
  if (!toConcept) {
    throw new ConceptError('CONCEPT_EDGE_TARGET_NOT_FOUND')
  }
  if (fromConcept.id === toConcept.id) {
    throw new ConceptError('CONCEPT_EDGE_SELF_LOOP')
  }

  const inserted = await db
    .insert(conceptEdges)
    .values({
      fromConceptId: fromConcept.id,
      toConceptId: toConcept.id,
      kind: input.kind,
    })
    .onConflictDoNothing({
      target: [
        conceptEdges.fromConceptId,
        conceptEdges.toConceptId,
        conceptEdges.kind,
      ],
    })
    .returning({ fromConceptId: conceptEdges.fromConceptId })
  if (!inserted[0]) {
    throw new ConceptError('CONCEPT_EDGE_CONFLICT')
  }

  return {
    fromConceptId: fromConcept.id,
    toConceptId: toConcept.id,
    kind: input.kind,
  }
}

/** Removes an edge during review. */
export async function removeConceptEdge(input: {
  fromConceptId: string
  toConceptId: string
  kind: ConceptEdgeKind
}): Promise<{ removed: true }> {
  const deleted = await db
    .delete(conceptEdges)
    .where(
      and(
        eq(conceptEdges.fromConceptId, input.fromConceptId),
        eq(conceptEdges.toConceptId, input.toConceptId),
        eq(conceptEdges.kind, input.kind),
      ),
    )
    .returning({ fromConceptId: conceptEdges.fromConceptId })
  if (!deleted[0]) {
    throw new ConceptError('CONCEPT_EDGE_NOT_FOUND')
  }
  return { removed: true }
}
