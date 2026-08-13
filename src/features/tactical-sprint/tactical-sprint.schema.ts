import { z } from 'zod'

import { SNIPPET_MAX_LENGTH } from '#/lib/ai/schemas'
// Narrow, client-safe entry point from the `exercise` feature (see
// arch_docs/dependency-rules.md's Feature Dependencies section): a Tactical
// Sprint can only ever finish by generating an exercise, so it is scoped
// to exactly the languages `exercise`'s own generation pipeline supports —
// reusing that already-exported constant/type keeps the two from drifting
// apart rather than duplicating the language list here. One-way: `exercise`
// never imports from `tactical-sprint`.
import {
  EXERCISE_GENERATION_LANGUAGES,
  type GenerateExerciseOutput,
} from '#/features/exercise/exercise-generation.schema'

/**
 * Input to start a Tactical Sprint (SPEC stories 4, 6-7, ticket #13): the
 * pasted snippet and its language. `snippet`'s cap mirrors the AI layer's
 * own `identifySnippetConcepts` bound (`SNIPPET_MAX_LENGTH`,
 * src/lib/ai/schemas.ts) so client-facing validation and the AI call's own
 * cap never drift apart.
 */
export const StartTacticalSprintInputSchema = z.object({
  language: z.enum(EXERCISE_GENERATION_LANGUAGES),
  snippet: z
    .string()
    .trim()
    .min(1, 'Paste a code snippet to analyze.')
    .max(SNIPPET_MAX_LENGTH),
})

export type StartTacticalSprintInput = z.infer<
  typeof StartTacticalSprintInputSchema
>

/**
 * The five Learner Model mastery states (ADR-0010, SPEC story 41), for
 * display only — mirrors the ordering `learners/mastery.server.ts` owns
 * without importing it into this browser-reachable schema module.
 */
export const MASTERY_STATES = [
  'unknown',
  'introduced',
  'practiced',
  'demonstrated',
  'retained',
] as const

export type MasteryStateView = (typeof MASTERY_STATES)[number]

/**
 * One concept identified in the pasted snippet (SPEC stories 4-5), resolved
 * against the Concept Graph and annotated with the learner's current
 * mastery so the UI can show why the weakest one was targeted.
 */
export type IdentifiedConcept = {
  /**
   * Undefined for an unmatched candidate that lost the weakest-concept
   * ranking (issue #125): ranking runs before drafting, and only the
   * winning candidate is ad-hoc drafted, so a losing unmatched slug was
   * never persisted and has no id to key or link it by.
   */
  conceptId: string | undefined
  slug: string
  description: string
  /**
   * Whether this slug already existed in the Concept Graph, or was
   * ad-hoc drafted for this sprint (ADR-0016's runtime-gap case).
   */
  matched: boolean
  masteryState: MasteryStateView
}

/**
 * Outcome of a full Tactical Sprint run (SPEC stories 4-7, ticket #13):
 * every identified concept with its resolved mastery, which one was
 * targeted as weakest, and the generated-and-Pre-Flight-verified exercise
 * for it — reusing `exercise`'s own `GenerateExerciseOutput` shape so the
 * result hands off directly into the existing exercise UI/submission flow.
 */
export type TacticalSprintResult = {
  identifiedConcepts: IdentifiedConcept[]
  targetConceptSlug: string
  exercise: GenerateExerciseOutput
}

/** Stable public tactical-sprint error codes. */
export type TacticalSprintErrorCode = 'SNIPPET_ANALYSIS_FAILED'

const TACTICAL_SPRINT_ERROR_MESSAGES: Record<TacticalSprintErrorCode, string> =
  {
    SNIPPET_ANALYSIS_FAILED: 'The snippet could not be analyzed. Try again.',
  }

/**
 * Safe error surfaced by the tactical-sprint server boundary. Failures
 * owned by another feature's step (an ad-hoc concept draft, exercise
 * generation) propagate as that feature's own stable error type instead of
 * being re-wrapped here — each already carries a safe public message.
 */
export class TacticalSprintError extends Error {
  readonly code: TacticalSprintErrorCode

  /** Creates a safe tactical-sprint feature error. */
  constructor(code: TacticalSprintErrorCode) {
    super(TACTICAL_SPRINT_ERROR_MESSAGES[code])
    this.name = 'TacticalSprintError'
    this.code = code
  }
}
