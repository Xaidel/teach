import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client.server', () => ({
  callTeacherEngine: vi.fn(),
  TeacherEngineError: class extends Error {
    readonly kind: string

    constructor(kind: string, message: string) {
      super(message)
      this.kind = kind
    }
  },
}))

import { callTeacherEngine } from './client.server'
import {
  explainConcept,
  generateHint,
  reviewSubmission,
} from './functions.server'
import {
  ExplainConceptOutputSchema,
  HintSchema,
  ReviewSubmissionOutputSchema,
} from './schemas'
import type {
  GenerateHintInput,
  ReviewSubmissionInput,
  ReviewSubmissionOutput,
} from './schemas'

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

const RUST_REFERENCE = `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}
`

const HINT_INPUT: GenerateHintInput = {
  language: 'rust',
  exerciseTitle: 'Is it even?',
  exercisePrompt: 'Implement is_even.',
  sandboxResult: FAILED_RESULT,
  targetLevel: 0,
  priorHints: [],
  referenceSolution: RUST_REFERENCE,
}

beforeEach(() => {
  callMock.mockReset()
})

describe('generateHint', () => {
  it('calls the client with low reasoning effort and the hint schema', async () => {
    callMock.mockResolvedValue({
      level: 0,
      content: 'What should is_even return when n is even?',
    })

    const hint = await generateHint(HINT_INPUT)

    expect(hint).toEqual({
      level: 0,
      content: 'What should is_even return when n is even?',
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
      content: 'Look at the return type of is_even.',
    })

    await generateHint({
      ...HINT_INPUT,
      targetLevel: 1,
      priorHints: [{ level: 0, content: 'first hint' }],
    })

    const call = callMock.mock.calls[0]?.[0]
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Level 0: first hint')
  })

  it('rejects a hint whose level does not match the requested level', async () => {
    callMock.mockResolvedValue({
      level: 5,
      content: 'Here is the full solution.',
    })

    await expect(generateHint(HINT_INPUT)).rejects.toMatchObject({
      kind: 'invalid_output',
    })
  })

  it('serves a safe fallback when the model output leaks the solution (issue #5)', async () => {
    callMock.mockResolvedValue({
      level: 0,
      content: RUST_REFERENCE,
    })

    const hint = await generateHint(HINT_INPUT)

    expect(hint.level).toBe(0)
    expect(hint.content).not.toContain('n % 2 == 0')
  })

  it('serves a safe fallback for a leak embedded in prose', async () => {
    callMock.mockResolvedValue({
      level: 2,
      content: 'Your function should return whether `n % 2 == 0` is true.',
    })

    const hint = await generateHint({
      ...HINT_INPUT,
      targetLevel: 2,
    })

    expect(hint.level).toBe(2)
    expect(hint.content).not.toContain('n % 2 == 0')
  })

  it('passes a safe hint through unchanged', async () => {
    callMock.mockResolvedValue({
      level: 0,
      content: 'What does the modulo operator do?',
    })

    const hint = await generateHint(HINT_INPUT)

    expect(hint).toEqual({
      level: 0,
      content: 'What does the modulo operator do?',
    })
  })

  it('never blocks a Level 5 hint (full solution is the point of the level)', async () => {
    callMock.mockResolvedValue({
      level: 5,
      content: RUST_REFERENCE,
    })

    const hint = await generateHint({
      ...HINT_INPUT,
      targetLevel: 5,
    })

    expect(hint).toEqual({ level: 5, content: RUST_REFERENCE })
  })

  it('allows partial solution code at Level 4 up to the tolerance', async () => {
    callMock.mockResolvedValue({
      level: 4,
      content: 'Consider whether `n % 2 == 0` is the condition you need.',
    })

    const hint = await generateHint({
      ...HINT_INPUT,
      targetLevel: 4,
    })

    expect(hint).toEqual({
      level: 4,
      content: 'Consider whether `n % 2 == 0` is the condition you need.',
    })
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

describe('reviewSubmission', () => {
  const REQUIRED_CRITERION =
    'Uses the remainder operator (%) to determine parity'
  const PROHIBITED_CRITERION =
    'Returns a hardcoded lookup table instead of computing parity'
  const ADVISORY_CRITERION = 'Keeps the function body minimal and readable'

  const RUBRIC = {
    required: [REQUIRED_CRITERION],
    prohibited: [PROHIBITED_CRITERION],
    advisory: [ADVISORY_CRITERION],
  }

  const REVIEW_INPUT: ReviewSubmissionInput = {
    language: 'rust',
    exerciseTitle: 'Is it even?',
    exercisePrompt: 'Implement is_even.',
    rubric: RUBRIC,
    submissionCode: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
  }

  const REVIEW_OUTPUT: ReviewSubmissionOutput = {
    overall: 'The submission satisfies every rubric criterion.',
    required: [
      {
        criterion: REQUIRED_CRITERION,
        verdict: 'satisfied',
        explanation: 'The body computes n % 2 == 0.',
      },
    ],
    prohibited: [
      {
        criterion: PROHIBITED_CRITERION,
        verdict: 'satisfied',
        explanation: 'No lookup table is present.',
      },
    ],
    advisory: [
      {
        criterion: ADVISORY_CRITERION,
        verdict: 'satisfied',
        explanation: 'The body is a single expression.',
      },
    ],
  }

  it('calls the client with high effort and the review schema', async () => {
    callMock.mockResolvedValue(REVIEW_OUTPUT)

    const output = await reviewSubmission(REVIEW_INPUT)

    expect(output).toEqual(REVIEW_OUTPUT)

    const call = callMock.mock.calls[0]?.[0]
    expect(call?.reasoningEffort).toBe('high')
    expect(call?.schemaName).toBe('stage2_review')
    expect(call?.outputSchema).toBe(ReviewSubmissionOutputSchema)
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Evaluation rubric:')
    expect(userMessage?.content).toContain(
      'Returns a hardcoded lookup table instead of computing parity',
    )
    expect(userMessage?.content).toContain('n % 2 == 0')
  })
})
