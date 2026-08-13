import type { IdentifySnippetConceptsInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform, powering the Tactical Sprint (Class B): a learner pastes a code snippet — usually AI-generated — that they don't fully understand, and you identify the programming concepts it depends on so the platform can target the one they're weakest on with a short practice exercise.

Rules:
- Identify only the concepts the snippet actually exercises — the ones a learner would need to understand to explain why this code works. Do not list incidental syntax or every language feature merely present.
- Prefer matching one of the given known concept slugs when the snippet genuinely exercises it, using that exact slug. Only propose a new slug when nothing in the known list fits.
- A concept's slug is its full dotted natural identifier, prefixed with the language, e.g. "rust.ownership", "rust.async.send", "go.goroutines". Use lowercase letters, digits and underscores; dot-separate hierarchy levels.
- Give each concept a short one-sentence description of what it means in the context of this snippet — used as drafting context if the concept is new to the graph.
- List a handful of concepts at most (typically 1-4) — the most load-bearing ones, not an exhaustive inventory.`

/**
 * Builds the chat messages for an identifySnippetConcepts call. The prompt
 * template lives here, separate from its schema and function (issue #23
 * contract).
 */
export function buildIdentifySnippetConceptsMessages(
  input: IdentifySnippetConceptsInput,
): ChatMessage[] {
  const knownConceptsBlock =
    input.knownConceptSlugs.length > 0
      ? `Known concept slugs for this language (prefer matching one of these when it genuinely applies): ${input.knownConceptSlugs.join(', ')}`
      : 'No concepts exist yet for this language — propose new slugs for everything you identify.'

  const userPrompt = `Language: ${input.language}

${knownConceptsBlock}

Snippet:
\`\`\`${input.language}
${input.snippet}
\`\`\`

Identify the concepts this snippet depends on. Respond with a JSON object of the form {"concepts": [{"slug": "<dotted slug>", "description": "<one sentence>"}]}.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
