import { z } from 'zod'

import type { AnalyzeMisconceptionsOutput } from '#/lib/ai/schemas'
// Shared constant (src/lib/mastery-states.ts): the five Learner Model
// mastery states (ADR-0010, SPEC story 41) for display only — importing the
// single source keeps this browser-reachable schema module from duplicating
// (and drifting from) the ordering `learners` and `tactical-sprint` use.
import { MASTERY_STATES } from '#/lib/mastery-states'
import type { SandboxLanguage } from '#/lib/sandbox/types'

export { MASTERY_STATES }

export type MasteryStateView = (typeof MASTERY_STATES)[number]

/**
 * Input to submitting an Explanation Assessment (SPEC stories 44-45, issue
 * #16): the concept to assess (by id) and the learner's free-form
 * explanation in their own words. `explanation` is capped generously — a
 * real explanation is short prose, and the AI call's own input schema does
 * not bound it either, but an unbounded client input is unbounded memory.
 */
export const SubmitExplanationAssessmentInputSchema = z.object({
  conceptId: z.uuid(),
  explanation: z
    .string()
    .trim()
    .min(1, 'Write an explanation first.')
    .max(10_000),
})

export type SubmitExplanationAssessmentInput = z.infer<
  typeof SubmitExplanationAssessmentInputSchema
>

/**
 * One concept eligible for the Practiced → Demonstrated gate (ADR-0015,
 * issue #16): the concept's identity plus whether the learner has already
 * passed an Explanation Assessment on it — so the UI can show what remains
 * on the way to Demonstrated.
 */
export type ExplanationAssessmentEligibleConcept = {
  conceptId: string
  slug: string
  difficulty: number
  hasPassedAssessment: boolean
}

/**
 * The overview of concepts a learner can be assessed on (ADR-0015: eligible
 * as soon as a concept reaches Practiced, no exercise-count threshold). The
 * language is the same 'rust' scope as the practice list (issue #8's
 * language until tickets #19/#20 land).
 */
export type ExplanationAssessmentOverview = {
  language: SandboxLanguage
  concepts: ExplanationAssessmentEligibleConcept[]
}

/**
 * Outcome of one submitted Explanation Assessment (issue #16): the
 * deterministic accuracy score and whether it passed the threshold, the
 * evaluator's raw findings, and the concept's mastery state after the
 * attempt — so the UI can explain that Demonstrated additionally requires
 * a passed Transfer Test (ADR-0015, ticket #17).
 */
export type ExplanationAssessmentResult = {
  accuracyScore: number
  passed: boolean
  analysis: AnalyzeMisconceptionsOutput
  masteryState: MasteryStateView
}

/** Stable public explanation-assessment error codes. */
export type ExplanationAssessmentErrorCode =
  'CONCEPT_NOT_FOUND' | 'CONCEPT_NOT_ELIGIBLE' | 'EXPLANATION_ANALYSIS_FAILED'

const EXPLANATION_ASSESSMENT_ERROR_MESSAGES: Record<
  ExplanationAssessmentErrorCode,
  string
> = {
  CONCEPT_NOT_FOUND: 'Concept not found.',
  CONCEPT_NOT_ELIGIBLE:
    'This concept is not eligible for an explanation assessment yet.',
  EXPLANATION_ANALYSIS_FAILED:
    'The explanation could not be analyzed. Try again.',
}

/**
 * Safe error surfaced by the explanation-assessment server boundary. The
 * AI call's own failures surface as `EXPLANATION_ANALYSIS_FAILED`; the
 * Learner Model transition never raises its own errors (promotion is a
 * best-effort gate on the record path).
 */
export class ExplanationAssessmentError extends Error {
  readonly code: ExplanationAssessmentErrorCode

  /** Creates a safe explanation-assessment feature error. */
  constructor(code: ExplanationAssessmentErrorCode) {
    super(EXPLANATION_ASSESSMENT_ERROR_MESSAGES[code])
    this.name = 'ExplanationAssessmentError'
    this.code = code
  }
}
