/** One chat message in an OpenAI-compatible request body. */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Reasoning effort dial per ADR-0004: low for hints and explanations, high
 * for generation and review. Fixed as a constant per task function, never
 * caller-overridable in v1 (issue #23 contract).
 */
export type ReasoningEffort = 'low' | 'high'
