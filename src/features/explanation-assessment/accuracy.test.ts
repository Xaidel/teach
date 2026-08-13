import { describe, expect, it } from 'vitest'

import {
  computeExplanationAccuracy,
  EXPLANATION_ACCURACY_PASS_THRESHOLD,
  INCORRECT_CLAIM_PENALTY,
  CONFLATED_PAIR_PENALTY,
} from './accuracy'
import type { AnalyzeMisconceptionsOutput } from '#/lib/ai/schemas'

const NO_FINDINGS: AnalyzeMisconceptionsOutput = {
  missing: [],
  incorrect: [],
  conflated: [],
}

const TARGET = 'rust.borrowing'

describe('computeExplanationAccuracy (issue #16 formula)', () => {
  it('scores a flawless explanation 1', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['rust.ownership'],
        analysis: NO_FINDINGS,
      }),
    ).toBe(1)
  })

  it('is a simple average over required sub-concepts: one missing of two = 0.5', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['rust.ownership'],
        analysis: {
          ...NO_FINDINGS,
          missing: [{ concept: 'rust.ownership', detail: 'omitted' }],
        },
      }),
    ).toBe(0.5)
  })

  it('one missing of four required sub-concepts = 0.75', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['a', 'b', 'c'],
        analysis: {
          ...NO_FINDINGS,
          missing: [{ concept: 'a', detail: 'omitted' }],
        },
      }),
    ).toBe(0.75)
  })

  it('a leaf concept with no prerequisites has the concept itself as its one required sub-concept', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: 'rust.intro',
        prerequisiteSlugs: [],
        analysis: {
          ...NO_FINDINGS,
          missing: [{ concept: 'rust.intro', detail: 'omitted' }],
        },
      }),
    ).toBe(0)
  })

  it('drops a missing finding naming a concept outside the required vocabulary', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['rust.ownership'],
        analysis: {
          ...NO_FINDINGS,
          missing: [{ concept: 'rust.lifetimes', detail: 'omitted' }],
        },
      }),
    ).toBe(1)
  })

  it('counts only in-vocabulary missing findings toward coverage', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['rust.ownership'],
        analysis: {
          ...NO_FINDINGS,
          missing: [
            { concept: 'rust.ownership', detail: 'omitted' },
            { concept: 'rust.lifetimes', detail: 'omitted' },
          ],
        },
      }),
    ).toBe(0.5)
  })

  it('penalizes each incorrect claim by a fixed weight', () => {
    const oneWrong = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: [],
      analysis: {
        ...NO_FINDINGS,
        incorrect: [{ claim: 'x', correction: 'y' }],
      },
    })
    expect(oneWrong).toBe(1 - INCORRECT_CLAIM_PENALTY)

    const twoWrong = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: [],
      analysis: {
        ...NO_FINDINGS,
        incorrect: [
          { claim: 'x', correction: 'y' },
          { claim: 'a', correction: 'b' },
        ],
      },
    })
    expect(twoWrong).toBe(1 - 2 * INCORRECT_CLAIM_PENALTY)
  })

  it('penalizes each conflation by a fixed weight', () => {
    const oneConflation = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: [],
      analysis: {
        ...NO_FINDINGS,
        conflated: [
          { concepts: ['rust.borrowing', 'rust.ownership'], detail: 'd' },
        ],
      },
    })
    expect(oneConflation).toBe(1 - CONFLATED_PAIR_PENALTY)
  })

  it('combines coverage, incorrect, and conflated penalties additively', () => {
    const score = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: ['rust.ownership'],
      analysis: {
        missing: [{ concept: 'rust.ownership', detail: 'omitted' }],
        incorrect: [{ claim: 'x', correction: 'y' }],
        conflated: [{ concepts: ['a', 'b'], detail: 'd' }],
      },
    })
    expect(score).toBe(0.5 - INCORRECT_CLAIM_PENALTY - CONFLATED_PAIR_PENALTY)
  })

  it('clamps at 0 when penalties exceed coverage', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: [],
        analysis: {
          ...NO_FINDINGS,
          incorrect: [
            { claim: 'x', correction: 'y' },
            { claim: 'a', correction: 'b' },
            { claim: 'm', correction: 'n' },
            { claim: 'p', correction: 'q' },
            { claim: 'r', correction: 's' },
          ],
        },
      }),
    ).toBe(0)
  })

  it('clamps coverage at 0 when in-vocabulary missing meets or exceeds required sub-concepts', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['rust.ownership'],
        analysis: {
          ...NO_FINDINGS,
          missing: [
            { concept: TARGET, detail: 'omitted' },
            { concept: 'rust.ownership', detail: 'omitted' },
          ],
        },
      }),
    ).toBe(0)
  })

  it('never exceeds 1', () => {
    expect(
      computeExplanationAccuracy({
        conceptSlug: TARGET,
        prerequisiteSlugs: ['a'],
        analysis: NO_FINDINGS,
      }),
    ).toBe(1)
  })
})

describe('EXPLANATION_ACCURACY_PASS_THRESHOLD', () => {
  it('is a passing bar that 0.7 satisfies and 0.5 does not', () => {
    expect(EXPLANATION_ACCURACY_PASS_THRESHOLD).toBe(0.7)
  })

  it('a two-sub-concept concept with one omission (0.5) does not pass', () => {
    const score = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: ['rust.ownership'],
      analysis: {
        ...NO_FINDINGS,
        missing: [{ concept: 'rust.ownership', detail: 'omitted' }],
      },
    })
    expect(score >= EXPLANATION_ACCURACY_PASS_THRESHOLD).toBe(false)
  })

  it('a four-sub-concept concept with one omission (0.75) passes', () => {
    const score = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: ['a', 'b', 'c'],
      analysis: {
        ...NO_FINDINGS,
        missing: [{ concept: 'a', detail: 'omitted' }],
      },
    })
    expect(score >= EXPLANATION_ACCURACY_PASS_THRESHOLD).toBe(true)
  })

  it('one incorrect claim on a leaf concept (0.75) still passes', () => {
    const score = computeExplanationAccuracy({
      conceptSlug: TARGET,
      prerequisiteSlugs: [],
      analysis: {
        ...NO_FINDINGS,
        incorrect: [{ claim: 'x', correction: 'y' }],
      },
    })
    expect(score >= EXPLANATION_ACCURACY_PASS_THRESHOLD).toBe(true)
  })
})
