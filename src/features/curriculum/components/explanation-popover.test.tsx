// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/features/learners/learners.functions', () => ({
  updateExplanationPreferencesFn: vi.fn(),
}))

import { updateExplanationPreferencesFn } from '#/features/learners/learners.functions'
import { ExplanationPopover } from './explanation-popover'

const updatePreferencesMock = vi.mocked(updateExplanationPreferencesFn)

describe('ExplanationPopover', () => {
  afterEach(() => {
    updatePreferencesMock.mockReset()
    // Safety net: a test that throws before its own `useRealTimers()` call
    // would otherwise leak fake timers into whatever runs next.
    vi.useRealTimers()
  })

  it('opens on click and shows the current depth and reference frame', async () => {
    const user = userEvent.setup()
    render(
      <ExplanationPopover
        initial={{ depth: 2, referenceFrame: 'a curious beginner' }}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('Explanation depth')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Adjust explanation level' }),
    )

    expect(screen.getByLabelText('Explanation depth')).toHaveValue('2')
    expect(screen.getByText('Beginner technical')).toBeInTheDocument()
    expect(screen.getByLabelText('Explain like...')).toHaveValue(
      'a curious beginner',
    )
  })

  it('debounces the depth slider, saving only once with the last value', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    updatePreferencesMock.mockResolvedValue({
      depth: 5,
      referenceFrame: null,
    })

    render(
      <ExplanationPopover
        initial={{ depth: 3, referenceFrame: null }}
        onSaved={onSaved}
      />,
    )

    // Open with real timers — userEvent's own internals don't get along
    // with fake ones — then switch to fake timers just to control the
    // debounce for the slider interaction itself.
    await user.click(
      screen.getByRole('button', { name: 'Adjust explanation level' }),
    )
    const slider = screen.getByLabelText('Explanation depth')

    vi.useFakeTimers()
    // A drag fires change once per tick — none of these should save yet.
    fireEvent.change(slider, { target: { value: '4' } })
    fireEvent.change(slider, { target: { value: '5' } })
    expect(updatePreferencesMock).not.toHaveBeenCalled()
    expect(screen.getByText('Runtime/Compiler internals')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(500)

    expect(updatePreferencesMock).toHaveBeenCalledExactlyOnceWith({
      data: { depth: 5 },
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('saves a reference frame through the persona input and calls onSaved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    updatePreferencesMock.mockResolvedValue({
      depth: 3,
      referenceFrame: 'senior Java developer',
    })

    render(
      <ExplanationPopover
        initial={{ depth: 3, referenceFrame: null }}
        onSaved={onSaved}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Adjust explanation level' }),
    )
    await user.type(
      screen.getByLabelText('Explain like...'),
      'senior Java developer',
    )
    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(updatePreferencesMock).toHaveBeenCalledExactlyOnceWith({
      data: { referenceFrame: 'senior Java developer' },
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('shows a safe error when saving fails', async () => {
    const user = userEvent.setup()
    updatePreferencesMock.mockRejectedValue(new Error('boom'))

    render(
      <ExplanationPopover
        initial={{ depth: 3, referenceFrame: null }}
        onSaved={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Adjust explanation level' }),
    )

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Explanation depth'), {
      target: { value: '4' },
    })
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()

    expect(
      await screen.findByText(
        'Could not save the explanation depth. Try again.',
      ),
    ).toBeInTheDocument()
  })

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ExplanationPopover
        initial={{ depth: 3, referenceFrame: null }}
        onSaved={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Adjust explanation level' }),
    )
    expect(screen.getByLabelText('Explanation depth')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByLabelText('Explanation depth')).not.toBeInTheDocument()
  })
})
