// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: string
  }): React.JSX.Element => <a {...props}>{children}</a>,
}))

vi.mock('../transfer-test.functions', () => ({
  generateTransferTestExerciseFn: vi.fn(),
}))

import { generateTransferTestExerciseFn } from '../transfer-test.functions'
import type { TransferTestEligibleConcept } from '../transfer-test.schema'
import { TransferTestCard } from './transfer-test-card'

const CONCEPTS: TransferTestEligibleConcept[] = [
  {
    conceptId: 'c1',
    slug: 'rust.borrowing',
    difficulty: 3,
    hasPassedTest: false,
  },
  {
    conceptId: 'c2',
    slug: 'rust.ownership',
    difficulty: 2,
    hasPassedTest: true,
  },
]

describe('TransferTestCard', () => {
  const generateMock = vi.mocked(generateTransferTestExerciseFn)

  beforeEach(() => {
    generateMock.mockReset()
  })

  it('shows an empty-state message when no concepts are eligible', () => {
    render(<TransferTestCard concepts={[]} />)

    expect(
      screen.getByText(/no concepts are eligible yet/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /generate a transfer test/i }),
    ).not.toBeInTheDocument()
  })

  it('lists each eligible concept and marks passed tests, selecting the first by default', () => {
    render(<TransferTestCard concepts={CONCEPTS} />)

    const borrowingButton = screen.getByRole('button', {
      name: /^rust\.borrowing/i,
    })
    expect(borrowingButton).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: /^rust\.ownership/i }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Transfer Test passed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /generate a transfer test for "rust\.borrowing"/i,
      }),
    ).toBeInTheDocument()
  })

  it('switches the selected concept on click', async () => {
    const user = userEvent.setup()
    render(<TransferTestCard concepts={CONCEPTS} />)

    await user.click(screen.getByRole('button', { name: /^rust\.ownership/i }))

    expect(
      screen.getByRole('button', {
        name: /generate a transfer test for "rust\.ownership"/i,
      }),
    ).toBeInTheDocument()
  })

  it('generates a Transfer Test for the selected concept and renders the hand-off', async () => {
    const user = userEvent.setup()
    generateMock.mockResolvedValue({
      exerciseId: 'ex-1',
      slug: 'rust-borrowing-a1b2c3d4',
      title: 'Fix the borrow',
      conceptSlug: 'rust.borrowing',
      reused: false,
    })

    render(<TransferTestCard concepts={CONCEPTS} />)

    await user.click(
      screen.getByRole('button', { name: /generate a transfer test/i }),
    )

    expect(generateMock).toHaveBeenCalledWith({ data: { conceptId: 'c1' } })
    expect(
      await screen.findByText(/Transfer Test ready for/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Fix the borrow')).toBeInTheDocument()
    expect(screen.getByText(/go solve it/i)).toBeInTheDocument()
  })

  it('renders reused hand-off copy when the instance already existed', async () => {
    const user = userEvent.setup()
    generateMock.mockResolvedValue({
      exerciseId: 'ex-1',
      slug: 'rust-borrowing-a1b2c3d4',
      title: 'Fix the borrow',
      conceptSlug: 'rust.borrowing',
      reused: true,
    })

    render(<TransferTestCard concepts={CONCEPTS} />)
    await user.click(
      screen.getByRole('button', { name: /generate a transfer test/i }),
    )

    expect(
      await screen.findByText(/Your Transfer Test for/i),
    ).toBeInTheDocument()
  })

  it('surfaces an error from the server function', async () => {
    const user = userEvent.setup()
    generateMock.mockRejectedValue(
      new Error(
        'The Transfer Test exercise could not be generated. Try again.',
      ),
    )

    render(<TransferTestCard concepts={CONCEPTS} />)
    await user.click(
      screen.getByRole('button', { name: /generate a transfer test/i }),
    )

    expect(
      await screen.findByText(
        'The Transfer Test exercise could not be generated. Try again.',
      ),
    ).toBeInTheDocument()
  })
})
