// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ResultPanel } from './result-panel'

describe('ResultPanel', () => {
  it('shows a passing verdict with the test count', () => {
    render(
      <ResultPanel
        result={{
          passed: true,
          tests: [
            { name: 'handles_zero', status: 'passed' },
            { name: 'returns_true_for_even_numbers', status: 'passed' },
          ],
        }}
      />,
    )

    expect(screen.getByText(/Passed — all 2 tests/)).toBeInTheDocument()
    expect(screen.getByText('handles_zero')).toBeInTheDocument()
    expect(
      screen.getByText('returns_true_for_even_numbers'),
    ).toBeInTheDocument()
  })

  it('shows a failing verdict with failed test messages', () => {
    render(
      <ResultPanel
        result={{
          passed: false,
          tests: [
            {
              name: 'returns_true_for_even_numbers',
              status: 'failed',
              message: 'assertion failed: exercise::is_even(4)',
            },
            { name: 'handles_zero', status: 'passed' },
          ],
        }}
      />,
    )

    expect(screen.getByText(/Failed — 1 of 2 tests/)).toBeInTheDocument()
    expect(
      screen.getByText('assertion failed: exercise::is_even(4)'),
    ).toBeInTheDocument()
  })

  it('shows the result-level message for timeouts and compile errors', () => {
    render(
      <ResultPanel
        result={{
          passed: false,
          tests: [],
          message: 'Execution exceeded the 10s sandbox limit and was killed.',
        }}
      />,
    )

    expect(screen.getByText(/10s sandbox limit/)).toBeInTheDocument()
  })

  it('shows the hint in place of the raw compiler/test error on failure', () => {
    render(
      <ResultPanel
        result={{
          passed: false,
          tests: [
            {
              name: 'returns_true_for_even_numbers',
              status: 'failed',
              message: 'assertion failed: exercise::is_even(4)',
            },
          ],
          message: 'error[E0308]: mismatched types',
        }}
        hint={{
          level: 0,
          content: 'What should is_even return when n is even?',
        }}
      />,
    )

    expect(screen.getByText(/Your hint · Level 0/)).toBeInTheDocument()
    expect(
      screen.getByText('What should is_even return when n is even?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('returns_true_for_even_numbers'),
    ).toBeInTheDocument()

    expect(
      screen.queryByText('assertion failed: exercise::is_even(4)'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('error[E0308]: mismatched types'),
    ).not.toBeInTheDocument()
  })

  it('still shows the raw error when no hint is available', () => {
    render(
      <ResultPanel
        result={{
          passed: false,
          tests: [
            {
              name: 'handles_zero',
              status: 'failed',
              message: 'assertion failed: exercise::is_even(0)',
            },
          ],
          message: 'compile error excerpt',
        }}
      />,
    )

    expect(screen.getByText('compile error excerpt')).toBeInTheDocument()
    expect(
      screen.getByText('assertion failed: exercise::is_even(0)'),
    ).toBeInTheDocument()
  })

  it('offers a Level 0 hint request on failure when no hint was served', () => {
    render(
      <ResultPanel
        onRequestHint={() => undefined}
        result={{
          passed: false,
          tests: [{ name: 'handles_zero', status: 'failed' }],
        }}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Get Level 0 hint' }),
    ).toBeInTheDocument()
  })

  it('offers the next level after a served hint', () => {
    render(
      <ResultPanel
        hint={{ level: 0, content: 'A conceptual question.' }}
        onRequestHint={() => undefined}
        result={{
          passed: false,
          tests: [{ name: 'handles_zero', status: 'failed' }],
        }}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Request Level 1' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Show full solution/ }),
    ).not.toBeInTheDocument()
  })

  it('offers the full solution only after Level 4 is served', () => {
    render(
      <ResultPanel
        hint={{ level: 4, content: 'Use the remainder.' }}
        onRequestHint={() => undefined}
        result={{
          passed: false,
          tests: [{ name: 'handles_zero', status: 'failed' }],
        }}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Show full solution · Level 5' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Request Level/ }),
    ).not.toBeInTheDocument()
  })

  it('hides hint controls on a passed attempt', () => {
    render(
      <ResultPanel
        onRequestHint={() => undefined}
        result={{
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed' }],
        }}
      />,
    )

    expect(
      screen.queryByRole('button', {
        name: /Get Level|Request Level|Show full solution/,
      }),
    ).not.toBeInTheDocument()
  })

  it('forwards the chosen action to the request handler', async () => {
    const user = userEvent.setup()
    const onRequestHint = vi.fn()

    render(
      <ResultPanel
        hint={{ level: 4, content: 'Use the remainder.' }}
        onRequestHint={onRequestHint}
        result={{
          passed: false,
          tests: [{ name: 'handles_zero', status: 'failed' }],
        }}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Show full solution · Level 5' }),
    )

    expect(onRequestHint).toHaveBeenCalledWith('full_solution')
  })

  it('shows a refactor request when a required criterion is violated (Stage 2)', () => {
    render(
      <ResultPanel
        result={{
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed' }],
        }}
        stage2Review={{
          passed: false,
          refactorRequest: 'Use the remainder operator (%) to compute parity.',
          criteria: [
            {
              criterion: 'Uses the remainder operator (%) to determine parity',
              kind: 'required',
              verdict: 'violated',
              explanation: 'The body never uses the remainder operator.',
            },
            {
              criterion: 'Keeps the function body minimal and readable',
              kind: 'advisory',
              verdict: 'satisfied',
              explanation: 'The body is a single expression.',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText(/Refactor requested/)).toBeInTheDocument()
    expect(
      screen.getByText('Use the remainder operator (%) to compute parity.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Uses the remainder operator (%) to determine parity'),
    ).toBeInTheDocument()
    expect(screen.getByText('violated')).toBeInTheDocument()
    expect(screen.getByText('required')).toBeInTheDocument()
  })

  it('shows the review-passed verdict when every criterion is satisfied (Stage 2)', () => {
    render(
      <ResultPanel
        result={{
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed' }],
        }}
        stage2Review={{
          passed: true,
          refactorRequest: null,
          criteria: [
            {
              criterion: 'Uses the remainder operator (%) to determine parity',
              kind: 'required',
              verdict: 'satisfied',
              explanation: 'The body computes n % 2 == 0.',
            },
          ],
        }}
      />,
    )

    expect(
      screen.getByText(
        /Code review passed — the submission satisfies the exercise rubric/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Uses the remainder operator (%) to determine parity'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Refactor requested/)).not.toBeInTheDocument()
  })

  it('surfaces advisory violations without blocking progress (Stage 2)', () => {
    render(
      <ResultPanel
        result={{
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed' }],
        }}
        stage2Review={{
          passed: true,
          refactorRequest: null,
          criteria: [
            {
              criterion: 'Keeps the function body minimal and readable',
              kind: 'advisory',
              verdict: 'violated',
              explanation: 'The body is longer than it needs to be.',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText(/Code review passed/)).toBeInTheDocument()
    expect(
      screen.getByText('Keeps the function body minimal and readable'),
    ).toBeInTheDocument()
    expect(screen.getByText('advisory')).toBeInTheDocument()
    expect(screen.queryByText(/Refactor requested/)).not.toBeInTheDocument()
  })

  it('renders nothing for Stage 2 when no review is present', () => {
    render(
      <ResultPanel
        result={{
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed' }],
        }}
        stage2Review={null}
      />,
    )

    expect(screen.queryByText(/Refactor requested/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Code review passed/)).not.toBeInTheDocument()
  })
})
