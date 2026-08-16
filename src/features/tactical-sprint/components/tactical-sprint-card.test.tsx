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

// CodeField's real shiki highlighting is exercised by code-field.test.tsx —
// stub it out here so this suite stays about the tactical-sprint flow, not
// wasm-backed grammar loading. Spying on the language it's called with lets
// language-prediction tests below assert the highlight actually follows the
// detected/overridden language without asserting on rendered HTML.
const useCodeHighlightMock =
  vi.fn<(code: string, language: string, theme: string) => string | undefined>()
vi.mock('#/features/exercise/use-code-highlight', () => ({
  useCodeHighlight: (code: string, language: string, theme: string) =>
    useCodeHighlightMock(code, language, theme),
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
      guidance: 'guided',
      sampleTests: null,
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
    useCodeHighlightMock.mockReset()
    useCodeHighlightMock.mockReturnValue(undefined)
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

  it('shows no language indicator until there is a snippet to detect from', () => {
    render(<TacticalSprintCard language="rust" />)

    expect(screen.queryByLabelText('Detected Language')).not.toBeInTheDocument()
  })

  it("predicts the pasted snippet's language and highlights it accordingly", () => {
    render(<TacticalSprintCard language="rust" />)

    const goSnippet =
      'package main\n\nfunc main() {\n\tx := 1\n\tfmt.Println(x)\n}'
    fireEvent.change(screen.getByLabelText('rust snippet'), {
      target: { value: goSnippet },
    })

    expect(screen.getByLabelText('Detected Language')).toHaveValue('go')
    expect(useCodeHighlightMock).toHaveBeenLastCalledWith(
      goSnippet,
      'go',
      expect.any(String),
    )
  })

  it('lets the learner correct a wrong prediction, and the override sticks through further edits', async () => {
    const user = userEvent.setup()
    render(<TacticalSprintCard language="rust" />)

    // Nothing in this snippet scores for any language, so detection falls
    // back to "rust" — wrong for what's actually Python.
    fireEvent.change(screen.getByLabelText('rust snippet'), {
      target: { value: 'x = 5' },
    })
    expect(screen.getByLabelText('Detected Language')).toHaveValue('rust')

    await user.selectOptions(
      screen.getByLabelText('Detected Language'),
      'python',
    )

    expect(screen.getByLabelText('Detected Language')).toHaveValue('python')
    expect(useCodeHighlightMock).toHaveBeenLastCalledWith(
      'x = 5',
      'python',
      expect.any(String),
    )

    // A further edit that would otherwise read as Rust doesn't clobber the
    // learner's explicit choice.
    fireEvent.change(screen.getByLabelText('rust snippet'), {
      target: { value: 'fn main() { println!("hi"); }' },
    })

    expect(screen.getByLabelText('Detected Language')).toHaveValue('python')
  })
})
