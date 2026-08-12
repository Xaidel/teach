import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HintSchema } from './schemas'
import type { ChatMessage } from './types'

// env.server.ts parses process.env at import time, so set values before the
// dynamic import below.
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
process.env.AI_API_KEY = 'test-key'
process.env.AI_API_BASE_URL = 'https://api.example.com/v1/'
process.env.AI_MODEL = 'test-model'

const { buildResponseFormat, callTeacherEngine } =
  await import('./client.server')

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are the AI Teacher.' },
  { role: 'user', content: 'Requested hint level: 0' },
]

const fetchMock =
  vi.fn<
    (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  >()

type CapturedRequest = {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function chatCompletionResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function captureRequest(
  input: string | URL | Request,
  init?: RequestInit,
): CapturedRequest {
  const rawBody = typeof init?.body === 'string' ? init.body : ''
  return {
    url:
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {},
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callTeacherEngine', () => {
  it('returns the validated structured output', async () => {
    fetchMock.mockResolvedValue(
      chatCompletionResponse(
        '{"level": 0, "content": "What does the test expect is_even(4) to return?"}',
      ),
    )

    const hint = await callTeacherEngine({
      reasoningEffort: 'low',
      schemaName: 'socratic_hint',
      outputSchema: HintSchema,
      messages: MESSAGES,
    })

    expect(hint).toEqual({
      level: 0,
      content: 'What does the test expect is_even(4) to return?',
    })
  })

  it('sends auth, model, reasoning effort, messages, and the structured-output schema', async () => {
    let captured: CapturedRequest | undefined
    fetchMock.mockImplementation((input, init) => {
      captured = captureRequest(input, init)
      return Promise.resolve(
        chatCompletionResponse('{"level": 0, "content": "Hmm"}'),
      )
    })

    await callTeacherEngine({
      reasoningEffort: 'low',
      schemaName: 'socratic_hint',
      outputSchema: HintSchema,
      messages: MESSAGES,
    })

    expect(captured?.url).toBe('https://api.example.com/v1/chat/completions')
    expect(captured?.headers.Authorization).toBe('Bearer test-key')
    expect(captured?.body.model).toBe('test-model')
    expect(captured?.body.reasoning_effort).toBe('low')
    expect(captured?.body.messages).toEqual(MESSAGES)
    expect(captured?.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'socratic_hint',
        strict: true,
      },
    })
  })

  it('maps a non-2xx response to an api_error', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'nope' } }), {
        status: 429,
      }),
    )

    await expect(
      callTeacherEngine({
        reasoningEffort: 'low',
        schemaName: 'socratic_hint',
        outputSchema: HintSchema,
        messages: MESSAGES,
      }),
    ).rejects.toMatchObject({ kind: 'api_error' })
  })

  it('maps a network failure to an api_error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      callTeacherEngine({
        reasoningEffort: 'low',
        schemaName: 'socratic_hint',
        outputSchema: HintSchema,
        messages: MESSAGES,
      }),
    ).rejects.toMatchObject({ kind: 'api_error' })
  })

  it('maps a non-JSON response body to an invalid_output error', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    await expect(
      callTeacherEngine({
        reasoningEffort: 'low',
        schemaName: 'socratic_hint',
        outputSchema: HintSchema,
        messages: MESSAGES,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('maps assistant content that fails schema validation to an invalid_output error', async () => {
    fetchMock.mockResolvedValue(
      chatCompletionResponse('{"level": 9, "content": ""}'),
    )

    await expect(
      callTeacherEngine({
        reasoningEffort: 'low',
        schemaName: 'socratic_hint',
        outputSchema: HintSchema,
        messages: MESSAGES,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('maps a payload without assistant content to an api_error', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    )

    await expect(
      callTeacherEngine({
        reasoningEffort: 'low',
        schemaName: 'socratic_hint',
        outputSchema: HintSchema,
        messages: MESSAGES,
      }),
    ).rejects.toMatchObject({ kind: 'api_error' })
  })
})

describe('buildResponseFormat (issue #54)', () => {
  it('builds the strict json_schema body for the default mode', () => {
    expect(
      buildResponseFormat('json_schema', 'socratic_hint', HintSchema),
    ).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'socratic_hint',
        strict: true,
      },
    })
  })

  it('omits the json_schema block in json_object mode', () => {
    expect(
      buildResponseFormat('json_object', 'socratic_hint', HintSchema),
    ).toEqual({
      type: 'json_object',
    })
  })
})

describe('callTeacherEngine response_format selection from env (issue #54)', () => {
  it('sends { type: json_object } without the schema block when AI_RESPONSE_FORMAT=json_object', async () => {
    process.env.AI_RESPONSE_FORMAT = 'json_object'
    vi.resetModules()
    const { callTeacherEngine: callJsonObject } =
      await import('./client.server')

    let captured: CapturedRequest | undefined
    fetchMock.mockImplementation((input, init) => {
      captured = captureRequest(input, init)
      return Promise.resolve(
        chatCompletionResponse('{"level": 0, "content": "Hmm"}'),
      )
    })

    await callJsonObject({
      reasoningEffort: 'low',
      schemaName: 'socratic_hint',
      outputSchema: HintSchema,
      messages: MESSAGES,
    })

    expect(captured?.body.response_format).toEqual({ type: 'json_object' })

    delete process.env.AI_RESPONSE_FORMAT
  })

  it('fails every call before any fetch when E2E_FORCE_AI_FAILURE is set (issue #93)', async () => {
    process.env.E2E_FORCE_AI_FAILURE = 'true'
    vi.resetModules()
    const { callTeacherEngine: callForced } = await import('./client.server')

    await expect(
      callForced({
        reasoningEffort: 'low',
        schemaName: 'socratic_hint',
        outputSchema: HintSchema,
        messages: MESSAGES,
      }),
    ).rejects.toMatchObject({ kind: 'api_error' })

    expect(fetchMock).not.toHaveBeenCalled()

    delete process.env.E2E_FORCE_AI_FAILURE
  })
})
