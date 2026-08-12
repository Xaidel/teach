import { describe, expect, it } from 'vitest'

import { TeacherEngineError } from '#/lib/ai/client.server'
import type { EvaluationRubric, ReviewSubmissionOutput } from '#/lib/ai/schemas'

import { buildStage2Review } from './stage2-review'

const REQUIRED_CRITERION = 'Uses the remainder operator (%) to determine parity'
const PROHIBITED_CRITERION =
  'Returns a hardcoded lookup table instead of computing parity'
const ADVISORY_CRITERION = 'Keeps the function body minimal and readable'

const RUBRIC: EvaluationRubric = {
  required: [REQUIRED_CRITERION],
  prohibited: [PROHIBITED_CRITERION],
  advisory: [ADVISORY_CRITERION],
}

const PASSING_OUTPUT: ReviewSubmissionOutput = {
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

describe('buildStage2Review', () => {
  it('passes when every required and prohibited criterion is satisfied', () => {
    const review = buildStage2Review(RUBRIC, PASSING_OUTPUT)

    expect(review).toEqual({
      passed: true,
      refactorRequest: null,
      criteria: [
        {
          criterion: REQUIRED_CRITERION,
          kind: 'required',
          verdict: 'satisfied',
          explanation: 'The body computes n % 2 == 0.',
        },
        {
          criterion: PROHIBITED_CRITERION,
          kind: 'prohibited',
          verdict: 'satisfied',
          explanation: 'No lookup table is present.',
        },
        {
          criterion: ADVISORY_CRITERION,
          kind: 'advisory',
          verdict: 'satisfied',
          explanation: 'The body is a single expression.',
        },
      ],
    })
  })

  it('blocks progress with a refactor request on a required-criterion violation', () => {
    const review = buildStage2Review(RUBRIC, {
      ...PASSING_OUTPUT,
      overall: 'Use the remainder operator (%) to compute parity.',
      required: [
        {
          criterion: REQUIRED_CRITERION,
          verdict: 'violated',
          explanation: 'The body never uses the remainder operator.',
        },
      ],
    })

    expect(review.passed).toBe(false)
    expect(review.refactorRequest).toBe(
      'Use the remainder operator (%) to compute parity.',
    )
  })

  it('blocks progress on a prohibited-criterion violation', () => {
    const review = buildStage2Review(RUBRIC, {
      ...PASSING_OUTPUT,
      prohibited: [
        {
          criterion: PROHIBITED_CRITERION,
          verdict: 'violated',
          explanation: 'A hardcoded lookup table is returned.',
        },
      ],
    })

    expect(review.passed).toBe(false)
    expect(review.refactorRequest).toBe(PASSING_OUTPUT.overall)
  })

  it('never blocks on advisory-criterion violations', () => {
    const review = buildStage2Review(RUBRIC, {
      ...PASSING_OUTPUT,
      advisory: [
        {
          criterion: ADVISORY_CRITERION,
          verdict: 'violated',
          explanation: 'The body is longer than it needs to be.',
        },
      ],
    })

    expect(review.passed).toBe(true)
    expect(review.refactorRequest).toBeNull()
    expect(review.criteria[2]).toMatchObject({
      kind: 'advisory',
      verdict: 'violated',
    })
  })

  it('rejects output with a missing verdict as invalid model output', () => {
    expect(() =>
      buildStage2Review(RUBRIC, { ...PASSING_OUTPUT, prohibited: [] }),
    ).toThrow(TeacherEngineError)
  })

  it('rejects output with an extra verdict as invalid model output', () => {
    expect(() =>
      buildStage2Review(RUBRIC, {
        ...PASSING_OUTPUT,
        required: [
          ...PASSING_OUTPUT.required,
          {
            criterion: 'An invented criterion',
            verdict: 'satisfied',
            explanation: 'Not part of the rubric.',
          },
        ],
      }),
    ).toThrow(TeacherEngineError)
  })

  it('rejects output that rewords or reorders a criterion as invalid model output', () => {
    expect(() =>
      buildStage2Review(RUBRIC, {
        ...PASSING_OUTPUT,
        required: [
          {
            criterion: 'Parity is determined with the remainder operator',
            verdict: 'satisfied',
            explanation: 'The body computes n % 2 == 0.',
          },
        ],
      }),
    ).toThrow(TeacherEngineError)
  })
})
