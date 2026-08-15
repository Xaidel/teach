// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StepLoadingScreen } from './step-loading-screen'

describe('StepLoadingScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders as a status region with the first generation message', () => {
    render(<StepLoadingScreen />)

    expect(
      screen.getByRole('status', { name: 'Preparing this step' }),
    ).toHaveTextContent('Generating the lesson…')
  })

  it('rotates through the generation messages over time', () => {
    render(<StepLoadingScreen />)

    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Writing the tests…')

    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Preparing the exercise…',
    )

    // Wraps back around rather than getting stuck on the last message.
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Generating the lesson…',
    )
  })

  it('crossfades the book icon between closed and open on every tick', () => {
    const { container } = render(<StepLoadingScreen />)
    const [closedBook, openBook] = container.querySelectorAll('svg')

    expect(closedBook).toHaveClass('opacity-100')
    expect(openBook).toHaveClass('opacity-0')

    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(closedBook).toHaveClass('opacity-0')
    expect(openBook).toHaveClass('opacity-100')

    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(closedBook).toHaveClass('opacity-100')
    expect(openBook).toHaveClass('opacity-0')
  })
})
