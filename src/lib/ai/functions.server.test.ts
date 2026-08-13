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

import { callTeacherEngine, TeacherEngineError } from './client.server'
import {
  draftConceptGraph,
  explainConcept,
  generateExercise,
  generateHint,
  reviewSubmission,
} from './functions.server'
import {
  ADVISORY_CRITERION,
  PROHIBITED_CRITERION,
  REQUIRED_CRITERION,
  STAGE2_RUBRIC,
} from '../../features/exercise/stage2-review.rubric'
import {
  DraftConceptGraphOutputSchema,
  ExplainConceptOutputSchema,
  GeneratedExerciseSchema,
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
  const REVIEW_INPUT: ReviewSubmissionInput = {
    language: 'rust',
    exerciseTitle: 'Is it even?',
    exercisePrompt: 'Implement is_even.',
    rubric: STAGE2_RUBRIC,
    submissionCode: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
  }

  const REVIEW_OUTPUT: ReviewSubmissionOutput = {
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

describe('draftConceptGraph', () => {
  const DRAFT_OUTPUT = {
    concepts: [
      { slug: 'rust.ownership', difficulty: 2 },
      { slug: 'rust.borrowing', difficulty: 3 },
    ],
    edges: [
      { from: 'rust.ownership', to: 'rust.borrowing', kind: 'prerequisite' },
    ],
  }

  /**
   * Resolves the client call through the passed output schema, mirroring the
   * real client's app-side validation (client.server.ts) against the task's
   * actual schema.
   */
  function mockDraftRawOutput(raw: unknown): void {
    callMock.mockImplementation((call) => {
      const parsed = call.outputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new TeacherEngineError(
          'invalid_output',
          'The AI Teacher Engine returned output that failed schema validation.',
          { cause: parsed.error },
        )
      }
      return Promise.resolve(parsed.data)
    })
  }

  it('calls the client with high effort and the draft schema', async () => {
    callMock.mockResolvedValue(DRAFT_OUTPUT)

    const output = await draftConceptGraph({ language: 'rust' })

    expect(output).toEqual(DRAFT_OUTPUT)

    const call = callMock.mock.calls[0]?.[0]
    expect(call?.reasoningEffort).toBe('high')
    expect(call?.schemaName).toBe('concept_graph_draft')
    expect(call?.outputSchema).toBe(DraftConceptGraphOutputSchema)
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Language: rust')
  })

  it('rejects a draft with an invalid slug shape as invalid output', async () => {
    mockDraftRawOutput({
      concepts: [{ slug: 'Bad Slug', difficulty: 3 }],
    })

    await expect(draftConceptGraph({ language: 'rust' })).rejects.toMatchObject(
      { kind: 'invalid_output' },
    )
  })

  it('rejects a draft with an out-of-range difficulty', async () => {
    mockDraftRawOutput({
      concepts: [{ slug: 'rust.ownership', difficulty: 9 }],
    })

    await expect(draftConceptGraph({ language: 'rust' })).rejects.toMatchObject(
      { kind: 'invalid_output' },
    )
  })

  it('rejects a draft with an unknown edge kind', async () => {
    mockDraftRawOutput({
      concepts: [{ slug: 'rust.ownership', difficulty: 2 }],
      edges: [{ from: 'rust.a', to: 'rust.b', kind: 'blocks' }],
    })

    await expect(draftConceptGraph({ language: 'rust' })).rejects.toMatchObject(
      { kind: 'invalid_output' },
    )
  })

  it('accepts a concepts-only draft when no edges are present', async () => {
    mockDraftRawOutput({
      concepts: [{ slug: 'rust.ownership', difficulty: 2 }],
    })

    await expect(draftConceptGraph({ language: 'rust' })).resolves.toEqual({
      concepts: [{ slug: 'rust.ownership', difficulty: 2 }],
      edges: [],
    })
  })
})

describe('generateExercise', () => {
  const GENERATED_OUTPUT = {
    title: 'Borrow or move?',
    prompt: 'Implement first(v: &Vec<u32>) -> u32.',
    starterCode: 'pub fn first(v: Vec<u32>) -> u32 { v[0] }',
    referenceSolution: 'pub fn first(v: &Vec<u32>) -> u32 { v[0] }',
    testSource: '#[test]\nfn borrows_its_argument() { assert!(true); }\n',
    targetConcepts: ['rust.borrowing'],
    prerequisites: ['rust.references'],
    difficulty: 3,
    estimatedMinutes: 8,
    constraints: ['std_only'],
    evaluation: {
      tests: ['borrows_its_argument'],
      rubric: {
        required: ['Takes the vector by reference'],
        prohibited: ['Consumes the vector'],
        advisory: ['Keeps the body short'],
      },
    },
  }

  /**
   * Resolves the client call through the passed output schema, mirroring the
   * real client's app-side validation (client.server.ts) against the task's
   * actual schema.
   */
  function mockGeneratedRawOutput(raw: unknown): void {
    callMock.mockImplementation((call) => {
      const parsed = call.outputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new TeacherEngineError(
          'invalid_output',
          'The AI Teacher Engine returned output that failed schema validation.',
          { cause: parsed.error },
        )
      }
      return Promise.resolve(parsed.data)
    })
  }

  it('calls the client with high effort and the generation schema', async () => {
    callMock.mockResolvedValue(GENERATED_OUTPUT)

    const output = await generateExercise({
      language: 'rust',
      conceptSlug: 'rust.borrowing',
      conceptDifficulty: 3,
    })

    expect(output).toEqual(GENERATED_OUTPUT)

    const call = callMock.mock.calls[0]?.[0]
    expect(call?.reasoningEffort).toBe('high')
    expect(call?.schemaName).toBe('exercise_generation')
    expect(call?.outputSchema).toBe(GeneratedExerciseSchema)
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('Language: rust')
    expect(userMessage?.content).toContain('Target concept: rust.borrowing')
    expect(userMessage?.content).toContain('Concept difficulty: 3 / 5')
  })

  it('rejects a draft with an empty test list as invalid output', async () => {
    mockGeneratedRawOutput({
      ...GENERATED_OUTPUT,
      evaluation: { tests: [], rubric: GENERATED_OUTPUT.evaluation.rubric },
    })

    await expect(
      generateExercise({
        language: 'rust',
        conceptSlug: 'rust.borrowing',
        conceptDifficulty: 3,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('rejects a draft with an out-of-range difficulty', async () => {
    mockGeneratedRawOutput({ ...GENERATED_OUTPUT, difficulty: 9 })

    await expect(
      generateExercise({
        language: 'rust',
        conceptSlug: 'rust.borrowing',
        conceptDifficulty: 3,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('rejects a draft with a malformed concept slug', async () => {
    mockGeneratedRawOutput({
      ...GENERATED_OUTPUT,
      targetConcepts: ['Borrowing'],
    })

    await expect(
      generateExercise({
        language: 'rust',
        conceptSlug: 'rust.borrowing',
        conceptDifficulty: 3,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('passes the adversarial flag into the prompt and returns the declared defect', async () => {
    const ADVERSARIAL_DEFECT = {
      kind: 'ownership',
      description: 'first consumes the vector instead of borrowing it',
      location: 'first',
      expectedBehavior:
        'first returns the first element while leaving the vector usable',
    }
    callMock.mockResolvedValue({
      ...GENERATED_OUTPUT,
      prompt:
        'The function first(v: Vec<u32>) contains a defect: it consumes the vector. Find the defect and fix it so the vector is still usable afterwards.',
      starterCode: 'pub fn first(v: Vec<u32>) -> u32 { v[0] }',
      defect: ADVERSARIAL_DEFECT,
    })

    const output = await generateExercise({
      language: 'rust',
      conceptSlug: 'rust.borrowing',
      conceptDifficulty: 3,
      adversarial: true,
    })

    expect(output.defect).toEqual(ADVERSARIAL_DEFECT)

    const call = callMock.mock.calls[0]?.[0]
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).toContain('ADVERSARIAL EXERCISE')
    expect(userMessage?.content).toContain(
      '"defect": {"kind": "ownership|lifetime|race_condition|broken_invariant|error_handling|api_misuse|other"',
    )
  })

  it('rejects an adversarial generation whose output declares no defect', async () => {
    callMock.mockResolvedValue(GENERATED_OUTPUT)

    await expect(
      generateExercise({
        language: 'rust',
        conceptSlug: 'rust.borrowing',
        conceptDifficulty: 3,
        adversarial: true,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('rejects a non-adversarial generation whose output declares a defect', async () => {
    // Symmetric guard (issue #117): a non-adversarial output carrying a
    // defect would persist as mode 'implement' yet render as adversarial —
    // contradictory labeling. Rejected as invalid output, so defect
    // presence ⟺ adversarial request.
    callMock.mockResolvedValue({
      ...GENERATED_OUTPUT,
      defect: {
        kind: 'ownership',
        description: 'first consumes the vector instead of borrowing it',
        location: 'first',
        expectedBehavior:
          'first returns the first element while leaving the vector usable',
      },
    })

    await expect(
      generateExercise({
        language: 'rust',
        conceptSlug: 'rust.borrowing',
        conceptDifficulty: 3,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('rejects an adversarial draft whose defect has an unknown kind', async () => {
    mockGeneratedRawOutput({
      ...GENERATED_OUTPUT,
      defect: {
        kind: 'random_bug',
        description: 'a made-up defect',
        location: 'first',
        expectedBehavior: 'works',
      },
    })

    await expect(
      generateExercise({
        language: 'rust',
        conceptSlug: 'rust.borrowing',
        conceptDifficulty: 3,
        adversarial: true,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('omits the adversarial contract from a non-adversarial generation prompt', async () => {
    callMock.mockResolvedValue(GENERATED_OUTPUT)

    await generateExercise({
      language: 'rust',
      conceptSlug: 'rust.borrowing',
      conceptDifficulty: 3,
    })

    const call = callMock.mock.calls[0]?.[0]
    const userMessage = call?.messages.find(
      (message) => message.role === 'user',
    )
    expect(userMessage?.content).not.toContain('ADVERSARIAL EXERCISE')
    expect(userMessage?.content).not.toContain('"defect":')
  })
})
