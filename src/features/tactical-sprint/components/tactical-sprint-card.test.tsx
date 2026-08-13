// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('../tactical-sprint.functions', () => ({
  startTacticalSprintFn: vi.fn(),
}))

import { startTacticalSprintFn } from '../tactical-sprint.functions'
import type { TacticalSprintResult } from '../tactical-sprint.schema'
import { TacticalSprintCard } from './tactical-sprint-card'

const RESULT: TacticalSprintResult = {
  identifiedConcepts: [
    {
      conceptId: 'c1',
      slug: 'rust.borrowing',
      description: 'Takes a reference instead of ownership.',
      matched: true,
      masteryState: 'practiced',
    },
    {
      conceptId: 'c2',
      slug: 'rust.lifetimes',
      description: 'A brand new concept for this graph.',
      matched: false,
      masteryState: 'unknown',
    },
  ],
  targetConceptSlug: 'rust.lifetimes',
  exercise: {
    kind: 'generated',
    exercise: {
      id: 'e1',
      slug: 'rust-lifetimes-a1b2c3d4',
      language: 'rust',
      title: 'Fix the lifetime',
      prompt: 'Fill in the body.',
      starterCode: 'pub fn f() -> u32 { 0 }',
    },
    conceptSlug: 'rust.lifetimes',
    targetConcepts: ['rust.lifetimes'],
    prerequisites: [],
    estimatedMinutes: 7,
    constraints: ['std_only', 'preserve_signature'],
    preflight: {
      attemptNumber: 1,
      passed: true,
      checks: [
        { name: 'reference_passes', passed: true },
        { name: 'broken_state_fails', passed: true },
        { name: 'failure_matches_concept', passed: true },
      ],
    },
    simplified: false,
  },
}

describe('TacticalSprintCard', () => {
  const startTacticalSprintFnMock = vi.mocked(startTacticalSprintFn)

  beforeEach(() => {
    startTacticalSprintFnMock.mockReset()
  })

  it('disables analysis until a snippet is entered', () => {
    render(<TacticalSprintCard language="rust" />)

    expect(
      screen.getByRole('button', { name: 'Analyze snippet' }),
    ).toBeDisabled()
  })

  it('analyzes the pasted snippet and shows the identified concepts with the weakest marked as target', async () => {
    const user = userEvent.setup()
    startTacticalSprintFnMock.mockResolvedValue(RESULT)
    render(<TacticalSprintCard language="rust" />)

    fireEvent.change(screen.getByLabelText('rust snippet'), {
      target: { value: 'pub fn f(v: Vec<u32>) -> u32 { v[0] }' },
    })
    await user.click(screen.getByRole('button', { name: 'Analyze snippet' }))

    expect(startTacticalSprintFnMock).toHaveBeenCalledWith({
      data: {
        language: 'rust',
        snippet: 'pub fn f(v: Vec<u32>) -> u32 { v[0] }',
      },
    })

    expect(screen.getByText('rust.borrowing')).toBeInTheDocument()
    expect(screen.getByText('rust.lifetimes')).toBeInTheDocument()
    expect(screen.getByText('Practiced')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('New concept')).toBeInTheDocument()
    expect(screen.getByText('Target — weakest')).toBeInTheDocument()
    expect(screen.getByText(/Fix the lifetime/)).toBeInTheDocument()
    expect(screen.getByText(/~7 min/)).toBeInTheDocument()
  })

  it('surfaces a graceful error when analysis fails', async () => {
    const user = userEvent.setup()
    startTacticalSprintFnMock.mockRejectedValue(
      new Error('The snippet could not be analyzed. Try again.'),
    )
    render(<TacticalSprintCard language="rust" />)

    fireEvent.change(screen.getByLabelText('rust snippet'), {
      target: { value: 'fn f() {}' },
    })
    await user.click(screen.getByRole('button', { name: 'Analyze snippet' }))

    expect(
      screen.getByText('The snippet could not be analyzed. Try again.'),
    ).toBeInTheDocument()
  })
})
