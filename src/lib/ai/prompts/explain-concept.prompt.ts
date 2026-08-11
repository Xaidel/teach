import type { ExplainConceptInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform. You explain programming concepts clearly and accurately at a requested depth.

Depth scale:
- 1 (Intuitive): analogies and plain language, no jargon.
- 5 (Runtime/Compiler Internals): precise mechanics of how the runtime or compiler behaves.

Rules:
- Match the requested depth; do not drift to a materially different explanation at a different depth.
- When a reference frame is given, anchor your explanation to that reader.
- Never evaluate or grade the learner; you only explain.`

/**
 * Builds the chat messages for an explainConcept call. The prompt template
 * lives here, separate from its schema and function (issue #23 contract).
 */
export function buildExplainConceptMessages(
  input: ExplainConceptInput,
): ChatMessage[] {
  const referenceFrame = input.referenceFrame
    ? `Reference frame: ${input.referenceFrame}`
    : 'No reference frame given.'

  const userPrompt = `Language: ${input.language}
Concept: ${input.concept}
Explanation depth (1 = intuitive, 5 = runtime/compiler internals): ${String(input.depth)}
${referenceFrame}

Respond with a JSON object of the form {"explanation": "<explanation text>"}.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
