import { TeacherEngineError, callTeacherEngine } from './client.server'
import { buildDraftConceptGraphMessages } from './prompts/draft-concept-graph.prompt'
import { buildExplainConceptMessages } from './prompts/explain-concept.prompt'
import { buildGenerateExerciseMessages } from './prompts/generate-exercise.prompt'
import { buildGenerateHintMessages } from './prompts/generate-hint.prompt'
import { buildReviewSubmissionMessages } from './prompts/review-submission.prompt'
import { checkPromptShield } from './prompt-shield'
import {
  DraftConceptGraphInputSchema,
  DraftConceptGraphOutputSchema,
  ExplainConceptInputSchema,
  ExplainConceptOutputSchema,
  GenerateExerciseInputSchema,
  GeneratedExerciseSchema,
  GenerateHintInputSchema,
  HintSchema,
  ReviewSubmissionInputSchema,
  ReviewSubmissionOutputSchema,
} from './schemas'
import type {
  DraftConceptGraphInput,
  DraftConceptGraphOutput,
  ExplainConceptInput,
  ExplainConceptOutput,
  GenerateExerciseInput,
  GeneratedExercise,
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
const REASONING_EFFORT_GENERATION: ReasoningEffort = 'high'

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
 * invalid model output. `depth`/`referenceFrame` (issue #12) steer only how
 * the hint is phrased — they never influence which level is served.
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

/**
 * Drafts a broad initial Concept Graph for a language (SPEC stories 38-40,
 * ADR-0016, issue #7): a wide set of concepts and their prerequisite/related
 * edges, AI-drafted and then structurally reviewed in-app. Generation is a
 * high-effort task (ADR-0004). The draft is just raw material — it passes
 * through the deterministic Concept Validation gate before anything is
 * usable, and the model never decides what is usable.
 */
export async function draftConceptGraph(
  input: DraftConceptGraphInput,
): Promise<DraftConceptGraphOutput> {
  const validated = DraftConceptGraphInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_GENERATION,
    schemaName: 'concept_graph_draft',
    outputSchema: DraftConceptGraphOutputSchema,
    messages: buildDraftConceptGraphMessages(validated),
  })
}

/**
 * Generates one exercise for a target concept (SPEC stories 27-29, PRD §13,
 * issue #8): the learner-facing prompt and code, the reference solution,
 * the test harness, and the exercise metadata (target concepts,
 * prerequisites, difficulty, estimated minutes, constraints, and the
 * evaluation spec — tests plus the Stage 2 rubric, ADR-0017/0019).
 * Generation is a high-effort task (ADR-0004). The output is only raw
 * material: it must pass the deterministic Pre-Flight Validation gate
 * (reference compiles and passes, intended broken state fails on the
 * concept's tests) before a learner ever sees it — the model never decides
 * what reaches the learner.
 */
export async function generateExercise(
  input: GenerateExerciseInput,
): Promise<GeneratedExercise> {
  const validated = GenerateExerciseInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_GENERATION,
    schemaName: 'exercise_generation',
    outputSchema: GeneratedExerciseSchema,
    messages: buildGenerateExerciseMessages(validated),
  })
}
