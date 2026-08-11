import { callTeacherEngine } from './client.server'
import { buildExplainConceptMessages } from './prompts/explain-concept.prompt'
import { buildGenerateHintMessages } from './prompts/generate-hint.prompt'
import {
  ExplainConceptInputSchema,
  ExplainConceptOutputSchema,
  GenerateHintInputSchema,
  HintSchema,
} from './schemas'
import type {
  ExplainConceptInput,
  ExplainConceptOutput,
  GenerateHintInput,
  Hint,
} from './schemas'
import type { ReasoningEffort } from './types'

/**
 * Fixed reasoning effort per task (ADR-0004's low/hint, high/generation-review
 * split), baked into each function and never caller-overridable in v1 (issue
 * #23 contract).
 */
const REASONING_EFFORT_HINT: ReasoningEffort = 'low'
const REASONING_EFFORT_EXPLAIN: ReasoningEffort = 'low'

/**
 * Generates one Socratic hint at a given escalation level for a Stage 1
 * failure (SPEC stories 18, 22-23). The AI Teacher Engine only produces the
 * hint text — pass/fail authority stays with the deterministic Stage 1 gate.
 */
export async function generateHint(input: GenerateHintInput): Promise<Hint> {
  const validated = GenerateHintInputSchema.parse(input)
  return callTeacherEngine({
    reasoningEffort: REASONING_EFFORT_HINT,
    schemaName: 'socratic_hint',
    outputSchema: HintSchema,
    messages: buildGenerateHintMessages(validated),
  })
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
