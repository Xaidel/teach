import type { ExplainConceptInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform. You explain programming concepts clearly and accurately at a requested depth.

Depth scale:
- 1 (Intuitive): analogies and plain language, no jargon.
- 5 (Runtime/Compiler Internals): precise mechanics of how the runtime or compiler behaves.

Rules:
- Match the requested depth; do not drift to a materially different explanation at a different depth.
- When a reference frame is given, anchor your explanation to that reader.
- Never evaluate or grade the learner; you only explain.
- Format code with Markdown: wrap any multi-line or standalone runnable
  example in a fenced code block (\`\`\`<language> ... \`\`\`); use single
  backticks for inline identifiers, keywords, and short snippets named in
  prose (e.g. \`main\`, \`println!\`).
- Format structure with Markdown too, when the explanation has real parts
  (e.g. distinct sub-ideas, a sequence of steps, several examples): break
  it into short sections under \`##\` or \`###\` headings, and use \`-\`
  list items to enumerate steps or options. Use \`**bold**\` sparingly, for
  a term on first use. Don't force headings or lists onto an explanation
  that's genuinely a single idea — plain paragraphs are fine when there's
  no real structure to show.`

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
