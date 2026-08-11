import { z } from 'zod'

import { env } from '#/lib/env.server'

import type { ChatMessage, ReasoningEffort } from './types'

/** Stable AI Teacher Engine client error codes (issue #3, #23 contract). */
export type TeacherEngineErrorCode = 'api_error' | 'invalid_output'

/**
 * Error thrown by the AI Teacher Engine client on any failure — never
 * returned as a success value. No retry is built into this layer; retry
 * policy is owned per-caller (issue #23 contract).
 */
export class TeacherEngineError extends Error {
  readonly code: TeacherEngineErrorCode

  /** Creates a teacher engine client error. */
  constructor(
    code: TeacherEngineErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'TeacherEngineError'
    this.code = code
  }
}

/** Hard ceiling on one AI Teacher Engine call. */
const TEACHER_ENGINE_TIMEOUT_MS = 30_000

/** One structured-output task call against the OpenAI-compatible API. */
export type TeacherEngineCall<T> = {
  reasoningEffort: ReasoningEffort
  schemaName: string
  outputSchema: z.ZodType<T>
  messages: ChatMessage[]
}

/**
 * Low-level call helper shared by every AI Teacher Engine task (ADR-0004,
 * issue #23 contract): auth, structured-output plumbing, app-side zod
 * validation as defense-in-depth, and the per-task reasoning-effort dial.
 * The AI Teacher Engine only produces content — it never decides pass/fail
 * (SPEC story 28), so the caller retains full authority over the result.
 */
export async function callTeacherEngine<T>(
  call: TeacherEngineCall<T>,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(
      `${env.AI_API_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.AI_MODEL,
          reasoning_effort: call.reasoningEffort,
          messages: call.messages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: call.schemaName,
              schema: z.toJSONSchema(call.outputSchema),
              strict: true,
            },
          },
        }),
        signal: AbortSignal.timeout(TEACHER_ENGINE_TIMEOUT_MS),
      },
    )
  } catch (error) {
    throw new TeacherEngineError(
      'api_error',
      'The AI Teacher Engine request failed to reach the API.',
      { cause: error },
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new TeacherEngineError(
      'api_error',
      `The AI Teacher Engine API responded with status ${String(response.status)}.`,
      detail ? { cause: detail } : undefined,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new TeacherEngineError(
      'invalid_output',
      'The AI Teacher Engine API returned a non-JSON response.',
      { cause: error },
    )
  }

  const content = extractAssistantContent(payload)
  if (!content) {
    throw new TeacherEngineError(
      'api_error',
      'The AI Teacher Engine API returned no assistant content.',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new TeacherEngineError(
      'invalid_output',
      'The AI Teacher Engine returned content that is not valid JSON.',
      { cause: error },
    )
  }

  const validated = call.outputSchema.safeParse(parsed)
  if (!validated.success) {
    throw new TeacherEngineError(
      'invalid_output',
      'The AI Teacher Engine returned output that failed schema validation.',
      { cause: validated.error },
    )
  }

  return validated.data
}

/**
 * Extracts the assistant message content from an OpenAI-compatible chat
 * completions payload, or undefined when the payload carries none.
 */
function extractAssistantContent(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined
  }
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) {
    return undefined
  }
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) {
    return undefined
  }
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.length > 0 ? content : undefined
}
