import { TeacherEngineError, callTeacherEngine } from './client.server'
import { buildExplainConceptMessages } from './prompts/explain-concept.prompt'
import { buildGenerateHintMessages } from './prompts/generate-hint.prompt'
import { buildReviewSubmissionMessages } from './prompts/review-submission.prompt'
import { checkPromptShield } from './prompt-shield'
import {
  ExplainConceptInputSchema,
  ExplainConceptOutputSchema,
  GenerateHintInputSchema,
  HintSchema,
  ReviewSubmissionInputSchema,
  ReviewSubmissionOutputSchema,
} from './schemas'
import type {
  ExplainConceptInput,
  ExplainConceptOutput,
  GenerateHintInput,
  Hint,
  ReviewSubmissionInput,
  ReviewSubmissionOutput,
} from './schemas'
import type { ReasoningEffort } from './types'

/**
 * Fixed reasoning effort per task (ADR-0004's low/hint, high/generation-review
 * split), baked into each function and never caller-overridable in v1 (issue
 * #23 contract).
 */
const REASONING_EFFORT_HINT: ReasoningEffort = 'low'
const REASONING_EFFORT_EXPLAIN: ReasoningEffort = 'low'
const REASONING_EFFORT_REVIEW: ReasoningEffort = 'high'

/**
 * The safe fallback served when the Prompt Shield blocks a hint: a generic,
 * level-appropriate message that can never leak the reference solution. The
 * hint level is preserved so the ladder's recorded level stays consistent
 * with what was requested (issue #5, AC: safe fallback, not a broken UI
 * state).
 */
function shieldedHintFallback(level: number): Hint {
  return {
    level,
    content:
      'I cannot safely share that hint at this level right now. Try re-reading the failure diagnostics and taking the smallest next step.',
  }
}

/**
 * Generates one Socratic hint at a given escalation level for a Stage 1
 * failure (SPEC stories 18, 22-23). The AI Teacher Engine only produces the
 * hint text — pass/fail authority stays with the deterministic Stage 1 gate.
 * The returned hint's level must match the requested level; a mismatch is
 * invalid model output.
 *
 * The returned hint is checked by the Prompt Shield against the
 * Pre-Flight-verified reference solution (ADR-0008, ADR-0012): when the
 * model output would leak solution code above the current hint level, a
 * generic safe fallback is served instead — the leak never renders.
 */
export async function generateHint(input: GenerateHintInput): Promise<Hint> {
  const validated = GenerateHintInputSchema.parse(input)
  const hint = await callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_HINT,
    schemaName: 'socratic_hint',
    outputSchema: HintSchema,
    messages: buildGenerateHintMessages(validated),
  })

  if (hint.level !== validated.targetLevel) {
    throw new TeacherEngineError(
      'invalid_output',
      `The AI Teacher Engine returned hint level ${String(hint.level)} for requested level ${String(validated.targetLevel)}.`,
    )
  }

  if (
    checkPromptShield({
      content: hint.content,
      referenceSolution: validated.referenceSolution,
      language: validated.language,
      hintLevel: hint.level,
    }) === 'block'
  ) {
    return shieldedHintFallback(hint.level)
  }

  return hint
}

/** Explains a concept at a presentation depth (SPEC story 11). */
export async function explainConcept(
  input: ExplainConceptInput,
): Promise<ExplainConceptOutput> {
  const validated = ExplainConceptInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_EXPLAIN,
    schemaName: 'concept_explanation',
    outputSchema: ExplainConceptOutputSchema,
    messages: buildExplainConceptMessages(validated),
  })
}

/**
 * Reviews a Stage 1-passing submission against the exercise's Stage 2
 * rubric (SPEC stories 19-21, issue #6). The AI Teacher Engine only
 * assesses each rubric criterion — whether a violation blocks progress is
 * derived deterministically app-side from the criterion's kind (only
 * `required`/`prohibited` block, PRD §18), so pass/fail authority never
 * rests with the model (SPEC story 28).
 */
export async function reviewSubmission(
  input: ReviewSubmissionInput,
): Promise<ReviewSubmissionOutput> {
  const validated = ReviewSubmissionInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_REVIEW,
    schemaName: 'stage2_review',
    outputSchema: ReviewSubmissionOutputSchema,
    messages: buildReviewSubmissionMessages(validated),
  })
}
