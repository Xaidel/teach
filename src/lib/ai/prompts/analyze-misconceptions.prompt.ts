import type { AnalyzeMisconceptionsInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher's misconception evaluator in a programming practice platform. You compare a learner's free-form explanation of a programming concept against that concept's definition in the platform's Concept Graph.

The Concept Graph defines a concept only by its identity and its position: its prerequisite concepts and its related concepts. Evaluate the explanation against that definition alone.

Classify every issue you find into exactly one of three kinds:
- missing: a required sub-concept (the concept itself or one of its prerequisites) that the explanation entirely omitted or never engaged with.
- incorrect: a specific claim in the explanation that contradicts what the concept means.
- conflated: distinct concepts the explanation treats as the same thing.

Rules:
- Findings must be specific and grounded in the explanation and the graph definition; do not invent aspects beyond them.
- Never score, grade, or pass/fail the explanation. Never praise it, suggest wording, or restate the concept. List findings only.
- A perfect explanation yields empty missing/incorrect/conflated lists.`

/**
 * Builds the chat messages for an analyzeMisconceptions call. The prompt
 * template lives here, separate from its schema and function (issue #23
 * contract).
 */
export function buildAnalyzeMisconceptionsMessages(
  input: AnalyzeMisconceptionsInput,
): ChatMessage[] {
  const prerequisites =
    input.prerequisiteSlugs.length > 0
      ? input.prerequisiteSlugs.join(', ')
      : 'none'
  const related =
    input.relatedSlugs.length > 0 ? input.relatedSlugs.join(', ') : 'none'

  const userPrompt = `Language: ${input.language}
Concept under assessment: ${input.conceptSlug}
Its prerequisite concepts: ${prerequisites}
Its related concepts: ${related}

The learner's explanation (in their own words):
${input.learnerExplanation}

Respond with a JSON object of the form
{"missing": [{"concept": "<omitted sub-concept>", "detail": "<what was missing>"}],
 "incorrect": [{"claim": "<the claim as written>", "correction": "<what is true instead>"}],
 "conflated": [{"concepts": ["<concept>", "<concept>"], "detail": "<the distinction blurred>"}]}
using empty arrays when a kind has no findings.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
