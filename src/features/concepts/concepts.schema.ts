import { z } from 'zod'

import type { ConceptEdgeDraft } from '#/lib/ai/schemas'
import {
  CONCEPT_DIFFICULTY_MAX,
  CONCEPT_DIFFICULTY_MIN,
  CONCEPT_EDGE_KINDS,
  CONCEPT_SLUG_PATTERN,
  CONCEPT_STATUSES,
} from '#/lib/concept-graph'
import { SANDBOX_LANGUAGES, isSandboxLanguage } from '#/lib/sandbox/types'
import type { SandboxLanguage } from '#/lib/sandbox/types'
export type { SandboxLanguage } from '#/lib/sandbox/types'

import type { EdgeValidationStatus } from './concept-validation'

/** Concept review status, tracked by the reviewer only (ADR-0016). */
export const ConceptStatusSchema = z.enum(CONCEPT_STATUSES)

export type ConceptStatus = z.infer<typeof ConceptStatusSchema>

/** Concept edge kind: prerequisite ordering vs. related link (ADR-0010). */
export const ConceptEdgeKindSchema = z.enum(CONCEPT_EDGE_KINDS)

export type ConceptEdgeKind = z.infer<typeof ConceptEdgeKindSchema>

/** One concept as exposed to the review route and browser UI. */
export const ConceptSchema = z.object({
  id: z.string().min(1),
  language: z.enum(SANDBOX_LANGUAGES),
  slug: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  status: ConceptStatusSchema,
})

export type Concept = z.infer<typeof ConceptSchema>

/**
 * One concept edge in the review view. `fromSlug`/`toSlug` carry the human-
 * readable endpoints; `validation` is the edge's live Concept Validation
 * verdict, so the reviewer sees exactly what is excluded from use.
 */
export type ConceptEdgeView = {
  fromConceptId: string
  toConceptId: string
  fromSlug: string
  toSlug: string
  kind: ConceptEdgeKind
  validation: EdgeValidationStatus
}

/** One concept with every edge touching it, for structural review. */
export type ConceptReviewItem = Concept & {
  edges: ConceptEdgeView[]
}

/** The full review view for one language (ADR-0016 — in-app review UI). */
export type ConceptReview = {
  language: SandboxLanguage
  concepts: ConceptReviewItem[]
}

/** The Class A/Class B projection: only Concept-Validation-passing rows. */
export type UsableConceptGraph = {
  language: SandboxLanguage
  concepts: { id: string; slug: string; difficulty: number }[]
  edges: {
    fromConceptId: string
    toConceptId: string
    kind: ConceptEdgeKind
  }[]
}

/** Outcome of one AI draft + persist cycle, reported back to the reviewer. */
export type DraftConceptsOutput = {
  language: SandboxLanguage
  /** Concepts newly persisted (duplicates of existing rows excluded). */
  conceptsInserted: number
  /** Edges newly persisted (duplicates of existing rows excluded). */
  edgesInserted: number
  /** Drafted concepts that already existed and were skipped. */
  duplicateConcepts: number
  /** Drafted edges that already existed and were skipped. */
  duplicateEdges: number
  /**
   * Persisted prerequisite edges that fail Concept Validation (they lie on
   * a cycle). They remain visible for correction but are excluded from
   * Class A/Class B use regardless of Review Status (ADR-0016).
   */
  cycleEdges: ConceptEdgeDraft[]
  /** Drafted self-loops, dropped — the schema forbids them. */
  droppedSelfLoops: ConceptEdgeDraft[]
  /**
   * Drafted edges whose endpoints are not real concepts in this draft,
   * dropped and reported for correction (ADR-0016).
   */
  droppedDanglingEdges: ConceptEdgeDraft[]
}

/** Input for drafting one language's Concept Graph. */
export const DraftConceptsInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
})

export type DraftConceptsInput = z.infer<typeof DraftConceptsInputSchema>

/** Input for toggling a concept's review status (ADR-0016). */
export const SetConceptStatusInputSchema = z.object({
  conceptId: z.uuid(),
  status: ConceptStatusSchema,
})

export type SetConceptStatusInput = z.infer<typeof SetConceptStatusInputSchema>

/** Input for correcting a concept's name or difficulty in review. */
export const UpdateConceptInputSchema = z.object({
  conceptId: z.uuid(),
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
  difficulty: z
    .number()
    .int()
    .min(CONCEPT_DIFFICULTY_MIN)
    .max(CONCEPT_DIFFICULTY_MAX),
})

export type UpdateConceptInput = z.infer<typeof UpdateConceptInputSchema>

/** Input for adding an edge from a concept to an existing concept slug. */
export const AddConceptEdgeInputSchema = z.object({
  fromConceptId: z.uuid(),
  toSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
  kind: ConceptEdgeKindSchema,
})

export type AddConceptEdgeInput = z.infer<typeof AddConceptEdgeInputSchema>

/** Input for removing an edge during review. */
export const RemoveConceptEdgeInputSchema = z.object({
  fromConceptId: z.uuid(),
  toConceptId: z.uuid(),
  kind: ConceptEdgeKindSchema,
})

export type RemoveConceptEdgeInput = z.infer<
  typeof RemoveConceptEdgeInputSchema
>

/** Input for the review route's language search param. */
export const ConceptLanguageSearchSchema = z.enum(SANDBOX_LANGUAGES)

/**
 * Normalizes an untrusted URL search value into a sandbox language,
 * defaulting to rust. The review route's search params are route-coupled,
 * so they are validated with an explicit function (this repo's codegen
 * resolves no search map), narrowing through a known union instead of any.
 */
export function normalizeConceptLanguage(raw: unknown): SandboxLanguage {
  if (typeof raw === 'string' && isSandboxLanguage(raw)) {
    return raw
  }
  return 'rust'
}

/** Stable public Concept Graph error codes. */
export type ConceptErrorCode =
  | 'CONCEPT_NOT_FOUND'
  | 'CONCEPT_SLUG_TAKEN'
  | 'CONCEPT_EDGE_TARGET_NOT_FOUND'
  | 'CONCEPT_EDGE_SELF_LOOP'
  | 'CONCEPT_EDGE_CONFLICT'
  | 'CONCEPT_EDGE_NOT_FOUND'
  | 'CONCEPT_DRAFT_FAILED'
  | 'PREREQUISITES_NOT_PRACTICED'

const CONCEPT_ERROR_MESSAGES: Record<ConceptErrorCode, string> = {
  CONCEPT_NOT_FOUND: 'Concept not found.',
  CONCEPT_SLUG_TAKEN:
    'Another concept in this language already uses that slug.',
  CONCEPT_EDGE_TARGET_NOT_FOUND:
    'The target concept does not exist in this language.',
  CONCEPT_EDGE_SELF_LOOP: 'A concept cannot be an edge to itself.',
  CONCEPT_EDGE_CONFLICT: 'That edge already exists.',
  CONCEPT_EDGE_NOT_FOUND: 'That edge does not exist.',
  CONCEPT_DRAFT_FAILED: 'The Concept Graph draft could not be generated.',
  PREREQUISITES_NOT_PRACTICED:
    "This concept's prerequisites are not all Practiced yet — complete the earlier steps first.",
}

/** Safe error surfaced by Concept Graph server boundaries. */
export class ConceptError extends Error {
  readonly code: ConceptErrorCode

  /** Creates a safe Concept Graph feature error. */
  constructor(code: ConceptErrorCode) {
    super(CONCEPT_ERROR_MESSAGES[code])
    this.name = 'ConceptError'
    this.code = code
  }
}
