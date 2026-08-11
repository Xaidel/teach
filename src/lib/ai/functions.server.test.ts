import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client.server', () => ({
  callTeacherEngine: vi.fn(),
  TeacherEngineError: class extends Error {
    readonly code = 'api_error' as const
  },
}))

import { callTeacherEngine } from './client.server'
import { explainConcept, generateHint } from './functions.server'
import { ExplainConceptOutputSchema, HintSchema } from './schemas'
import type { GenerateHintInput } from './schemas'

const callMock = vi.mocked(callTeacherEngine)

const FAILED_RESULT: GenerateHintInput['sandboxResult'] = {
  passed: false,
  tests: [
    {
      name: 'returns_true_for_even_numbers',
      status: 'failed',
      message: 'assertion failed: exercise::is_even(4)',
    },
  ],
}

beforeEach(() => {
  callMock.mockReset()
})

describe('generateHint', () => {
  it('calls the client with low reasoning effort and the hint schema', async () => {
    callMock.mockResolvedValue({
      level: 0,
      text: 'What should is_even return when n is even?',
    })

    const hint = await generateHint({
      language: 'rust',
      exerciseTitle: 'Is it even?',
      exercisePrompt: 'Implement is_even.',
      sandboxResult: FAILED_RESULT,
      targetLevel: 0,
      priorHints: [],
    })

    expect(hint).toEqual({
      level: 0,
      text: 'What should is_even return when n is even?',
    })

    const call = callMock.mock.calls[0]?.[0]
    expect(call?.reasoningEffort).toBe('low')
    expect(call?.schemaName).toBe('socratic_hint')
    expect(call?.outputSchema).toBe(HintSchema)
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Requested hint level: 0')
    expect(userMessage?.content).toContain(
      'None yet — this is the first hint in this attempt.',
    )
  })

  it('passes prior hints into the prompt so escalating levels do not repeat', async () => {
    callMock.mockResolvedValue({
      level: 1,
      text: 'Look at the return type of is_even.',
    })

    await generateHint({
      language: 'rust',
      exerciseTitle: 'Is it even?',
      exercisePrompt: 'Implement is_even.',
      sandboxResult: FAILED_RESULT,
      targetLevel: 1,
      priorHints: [{ level: 0, text: 'first hint' }],
    })

    const call = callMock.mock.calls[0]?.[0]
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Level 0: first hint')
  })
})

describe('explainConcept', () => {
  it('calls the client with low effort and the explanation schema', async () => {
    callMock.mockResolvedValue({
      explanation: 'Borrowing transfers ownership.',
    })

    const output = await explainConcept({
      language: 'rust',
      concept: 'borrowing',
      depth: 1,
    })

    expect(output).toEqual({ explanation: 'Borrowing transfers ownership.' })

    const call = callMock.mock.calls[0]?.[0]
    expect(call?.reasoningEffort).toBe('low')
    expect(call?.schemaName).toBe('concept_explanation')
    expect(call?.outputSchema).toBe(ExplainConceptOutputSchema)
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Concept: borrowing')
    expect(userMessage?.content).toContain('Explanation depth (1 = intuitive')
  })

  it('includes the reference frame when one is given', async () => {
    callMock.mockResolvedValue({ explanation: 'In Rust, ownership is…' })

    await explainConcept({
      language: 'rust',
      concept: 'ownership',
      depth: 3,
      referenceFrame: 'as a senior JavaScript developer',
    })

    const call = callMock.mock.calls[0]?.[0]
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain(
      'Reference frame: as a senior JavaScript developer',
    )
  })
})
