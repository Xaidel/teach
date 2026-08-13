import { TeacherEngineError, callTeacherEngine } from './client.server'
import { buildAnalyzeMisconceptionsMessages } from './prompts/analyze-misconceptions.prompt'
import { buildDraftConceptGraphMessages } from './prompts/draft-concept-graph.prompt'
import { buildExplainConceptMessages } from './prompts/explain-concept.prompt'
import { buildGenerateExerciseMessages } from './prompts/generate-exercise.prompt'
import { buildGenerateHintMessages } from './prompts/generate-hint.prompt'
import { buildIdentifySnippetConceptsMessages } from './prompts/identify-snippet-concepts.prompt'
import { buildReviewSubmissionMessages } from './prompts/review-submission.prompt'
import { checkPromptShield } from './prompt-shield'
import {
  AnalyzeMisconceptionsInputSchema,
  AnalyzeMisconceptionsOutputSchema,
  DraftConceptGraphInputSchema,
  DraftConceptGraphOutputSchema,
  ExplainConceptInputSchema,
  ExplainConceptOutputSchema,
  GenerateExerciseInputSchema,
  GeneratedExerciseSchema,
  GenerateHintInputSchema,
  HintSchema,
  IdentifySnippetConceptsInputSchema,
  IdentifySnippetConceptsOutputSchema,
  ReviewSubmissionInputSchema,
  ReviewSubmissionOutputSchema,
} from './schemas'
import type {
  AnalyzeMisconceptionsInput,
  AnalyzeMisconceptionsOutput,
  DraftConceptGraphInput,
  DraftConceptGraphOutput,
  ExplainConceptInput,
  ExplainConceptOutput,
  GenerateExerciseInput,
  GeneratedExercise,
  GenerateHintInput,
  Hint,
  IdentifySnippetConceptsInput,
  IdentifySnippetConceptsOutput,
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
const REASONING_EFFORT_IDENTIFY: ReasoningEffort = 'high'
const REASONING_EFFORT_ANALYZE: ReasoningEffort = 'high'

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
 * Identifies the concepts a pasted snippet depends on (SPEC stories 4-5,
 * ticket #13): the Tactical Sprint (Class B) entry point. `knownConceptSlugs`
 * biases the model toward matching an existing Concept Graph concept over
 * minting a new one; the caller resolves each returned slug against the
 * graph and ad-hoc drafts an unmatched one immediately (ADR-0016's
 * runtime-gap case) — this function only identifies, it never decides graph
 * membership or which concept is weakest. Generation-adjacent (feeds
 * exercise targeting and concept-graph writes), so it runs at high
 * reasoning effort like the other generation tasks (ADR-0004).
 */
export async function identifySnippetConcepts(
  input: IdentifySnippetConceptsInput,
): Promise<IdentifySnippetConceptsOutput> {
  const validated = IdentifySnippetConceptsInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_IDENTIFY,
    schemaName: 'snippet_concepts',
    outputSchema: IdentifySnippetConceptsOutputSchema,
    messages: buildIdentifySnippetConceptsMessages(validated),
  })
}

/**
 * Compares a learner's free-form explanation of a concept against that
 * concept's Concept Graph definition (SPEC story 45, issue #16): missing
 * sub-concepts, incorrect claims, and conflated ideas — and nothing else.
 * The function is standalone and atomic (issue #23 contract): it never
 * returns a score or verdict; the explanation-accuracy score is computed
 * deterministically app-side from its output (`explanation-assessment`'s
 * scoring module, ticket #16's owned formula), so the model never grades
 * the explanation. Review-adjacent analysis, so it runs at high reasoning
 * effort like the other review tasks (ADR-0004).
 */
export async function analyzeMisconceptions(
  input: AnalyzeMisconceptionsInput,
): Promise<AnalyzeMisconceptionsOutput> {
  const validated = AnalyzeMisconceptionsInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_ANALYZE,
    schemaName: 'misconception_analysis',
    outputSchema: AnalyzeMisconceptionsOutputSchema,
    messages: buildAnalyzeMisconceptionsMessages(validated),
  })
}

/**
 * Generates one exercise for a target concept (SPEC stories 27-29, PRD §13,
 * issue #8): the learner-facing prompt and code, the reference solution,
 * the test harness, and the exercise metadata (target concepts,
 * prerequisites, difficulty, estimated minutes, constraints, and the
 * evaluation spec — tests plus the Stage 2 rubric, ADR-0017/0019). When
 * `adversarial` is set, generation targets a debug-mode exercise whose
 * starterCode intentionally contains one known defect of a declared kind
 * (SPEC stories 51-52, PRD §20, issue #11) — the output must carry the
 * `defect` declaration, and an adversarial call whose output omits it is
 * rejected as invalid output: an invented, undeclared bug never ships.
 * Symmetrically, a non-adversarial call whose output declares a defect is
 * rejected too (issue #117): the `defect` field is debug-mode contract,
 * and a non-adversarial output carrying one would persist as mode
 * 'implement' yet render as adversarial — contradictory labeling.
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
  const output = await callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_GENERATION,
    schemaName: 'exercise_generation',
    outputSchema: GeneratedExerciseSchema,
    messages: buildGenerateExerciseMessages(validated),
  })

  if (validated.adversarial && !output.defect) {
    throw new TeacherEngineError(
      'invalid_output',
      'Adversarial generation returned no defect declaration.',
    )
  }
  if (!validated.adversarial && output.defect) {
    // Symmetric guard (issue #117): `defect` is a debug-mode contract field.
    // A non-adversarial output carrying one would persist as mode 'implement'
    // yet render as adversarial — contradictory labeling. Reject it as
    // invalid output so the invariant holds: defect present ⟺ adversarial.
    throw new TeacherEngineError(
      'invalid_output',
      'Non-adversarial generation returned a defect declaration.',
    )
  }

  return output
}
