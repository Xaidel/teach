/**
 * Shared Concept Graph domain constants (ADR-0010, ADR-0016): the dotted
 * natural slug format and the 1-5 difficulty scale, used by the Drizzle
 * schema, the AI Teacher Engine draft schema, and the concepts feature.
 */

/** Difficulty scale floor, per the PRD's concept format (§7). */
export const CONCEPT_DIFFICULTY_MIN = 1

/** Difficulty scale ceiling, per the PRD's concept format (§7). */
export const CONCEPT_DIFFICULTY_MAX = 5

/**
 * The dotted natural identifier format (ADR-0010), e.g. `rust.async.send`:
 * dot-separated lowercase segments, each starting with a letter.
 */
export const CONCEPT_SLUG_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/

/** Returns whether a value is a well-formed dotted concept slug. */
export function isValidConceptSlug(value: string): boolean {
  return CONCEPT_SLUG_PATTERN.test(value)
}

/** Concept edge kinds (ADR-0010): prerequisite ordering vs. related links. */
export const CONCEPT_EDGE_KINDS = ['prerequisite', 'related'] as const

export type ConceptEdgeKind = (typeof CONCEPT_EDGE_KINDS)[number]

/** Concept review statuses (ADR-0016): tracking markers, never usage gates. */
export const CONCEPT_STATUSES = ['draft', 'approved'] as const

export type ConceptStatus = (typeof CONCEPT_STATUSES)[number]
