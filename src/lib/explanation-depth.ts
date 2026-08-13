/**
 * Single source of truth for the explanation depth scale (issue #12, PRD
 * §12): 1 (Intuitive) through 5 (Runtime/Compiler Internals). Depth changes
 * presentation only — vocabulary, analogies, and technical precision — never
 * the underlying concept explained or, for hints, the escalation level
 * served (SPEC story 13).
 *
 * These constants feed the AI input schema bounds (`src/lib/ai/schemas.ts`),
 * the `learners` CHECK constraint (`src/db/schema.ts`), and the learner-facing
 * depth control, so a scale change is one coordinated edit rather than
 * several hardcoded bounds drifting apart.
 */

/** Depth 1: analogies and plain language, no jargon. */
export const EXPLANATION_DEPTH_MIN = 1

/** Depth 5: precise mechanics of how the runtime or compiler behaves. */
export const EXPLANATION_DEPTH_MAX = 5

/** Depth 3 (Developer): the neutral default before a learner sets one. */
export const DEFAULT_EXPLANATION_DEPTH = 3
