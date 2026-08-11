// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
})
