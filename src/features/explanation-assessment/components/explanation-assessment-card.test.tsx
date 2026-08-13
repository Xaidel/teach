// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../explanation-assessment.functions', () => ({
  submitExplanationAssessmentFn: vi.fn(),
}))

import { submitExplanationAssessmentFn } from '../explanation-assessment.functions'
import type { ExplanationAssessmentEligibleConcept } from '../explanation-assessment.schema'
import { ExplanationAssessmentCard } from './explanation-assessment-card'

const CONCEPTS: ExplanationAssessmentEligibleConcept[] = [
  {
    conceptId: 'c1',
    slug: 'rust.borrowing',
    difficulty: 3,
    hasPassedAssessment: false,
  },
  {
    conceptId: 'c2',
    slug: 'rust.ownership',
    difficulty: 2,
    hasPassedAssessment: true,
  },
]

describe('ExplanationAssessmentCard', () => {
  const submitMock = vi.mocked(submitExplanationAssessmentFn)

  beforeEach(() => {
    submitMock.mockReset()
  })

  it('shows an empty-state message when no concepts are eligible', () => {
    render(<ExplanationAssessmentCard concepts={[]} />)

    expect(
      screen.getByText(/no concepts are eligible yet/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /assess my explanation/i }),
    ).not.toBeInTheDocument()
  })

  it('disables the submit button until an explanation is written', () => {
    render(<ExplanationAssessmentCard concepts={CONCEPTS} />)

    expect(
      screen.getByRole('button', { name: /assess my explanation/i }),
    ).toBeDisabled()
  })

  it('lists each eligible concept and marks passed assessments', () => {
    render(<ExplanationAssessmentCard concepts={CONCEPTS} />)

    expect(
      screen.getByRole('button', { name: /rust\.borrowing/i }),
    ).toBeInTheDocument()
    const ownershipButton = screen.getByRole('button', {
      name: /rust\.ownership/i,
    })
    expect(ownershipButton).toBeInTheDocument()
    expect(
      screen.getAllByText('Assessment passed').length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('submits the explanation for the selected concept and renders the result', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      accuracyScore: 0.75,
      passed: true,
      analysis: {
        missing: [
          { concept: 'rust.ownership', detail: 'Never says who owns.' },
        ],
        incorrect: [],
        conflated: [],
      },
      masteryState: 'practiced',
    })

    render(<ExplanationAssessmentCard concepts={CONCEPTS} />)

    const textarea = screen.getByLabelText(/explain.*in your own words/i)
    await user.type(
      textarea,
      'Borrowing lets code use a value without owning it.',
    )
    await user.click(
      screen.getByRole('button', { name: /assess my explanation/i }),
    )

    expect(submitMock).toHaveBeenCalledWith({
      data: {
        conceptId: 'c1',
        explanation: 'Borrowing lets code use a value without owning it.',
      },
    })

    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByText(/Never says who owns\./)).toBeInTheDocument()
    expect(
      screen.getByText(/Demonstrated also requires a passed Transfer Test/i),
    ).toBeInTheDocument()
  })

  it('renders a failed assessment with its findings and retry affordance', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      accuracyScore: 0,
      passed: false,
      analysis: {
        missing: [],
        incorrect: [
          { claim: 'Borrowing moves the value.', correction: 'It lends it.' },
        ],
        conflated: [
          {
            concepts: ['rust.borrowing', 'rust.references'],
            detail: 'Distinct.',
          },
        ],
      },
      masteryState: 'practiced',
    })

    render(<ExplanationAssessmentCard concepts={CONCEPTS} />)

    const textarea = screen.getByLabelText(/explain.*in your own words/i)
    await user.type(textarea, 'Borrowing moves the value.')
    await user.click(
      screen.getByRole('button', { name: /assess my explanation/i }),
    )

    expect(await screen.findByText('0%')).toBeInTheDocument()
    expect(screen.getByText('Needs work — retry any time')).toBeInTheDocument()
    expect(screen.getByText('Borrowing moves the value.')).toBeInTheDocument()
    expect(
      screen.getByText('rust.borrowing / rust.references'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/you can retry whenever you like/i),
    ).toBeInTheDocument()
  })

  it('surfaces an error from the server function', async () => {
    const user = userEvent.setup()
    submitMock.mockRejectedValue(
      new Error('The explanation could not be analyzed. Try again.'),
    )

    render(<ExplanationAssessmentCard concepts={CONCEPTS} />)

    const textarea = screen.getByLabelText(/explain.*in your own words/i)
    await user.type(textarea, 'An explanation.')
    await user.click(
      screen.getByRole('button', { name: /assess my explanation/i }),
    )

    expect(
      await screen.findByText(
        'The explanation could not be analyzed. Try again.',
      ),
    ).toBeInTheDocument()
  })
})
