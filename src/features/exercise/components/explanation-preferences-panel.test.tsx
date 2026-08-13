// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/features/learners/learners.functions', () => ({
  updateExplanationPreferencesFn: vi.fn(),
}))

import { updateExplanationPreferencesFn } from '#/features/learners/learners.functions'

import { ExplanationPreferencesPanel } from './explanation-preferences-panel'

const updateMock = vi.mocked(updateExplanationPreferencesFn)

describe('ExplanationPreferencesPanel', () => {
  beforeEach(() => {
    updateMock.mockReset()
  })

  it('marks the learner’s current depth as pressed', () => {
    render(
      <ExplanationPreferencesPanel
        initial={{ depth: 3, referenceFrame: null }}
      />,
    )

    expect(
      screen.getByRole('button', { name: '3 · Developer' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: '1 · Intuitive' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves a new depth when a level is chosen', async () => {
    const user = userEvent.setup()
    updateMock.mockResolvedValue({ depth: 5, referenceFrame: null })

    render(
      <ExplanationPreferencesPanel
        initial={{ depth: 3, referenceFrame: null }}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: '5 · Runtime/Compiler internals' }),
    )

    expect(updateMock).toHaveBeenCalledWith({ data: { depth: 5 } })
    expect(
      await screen.findByRole('button', {
        name: '5 · Runtime/Compiler internals',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('saves a reference frame, trimmed', async () => {
    const user = userEvent.setup()
    updateMock.mockResolvedValue({
      depth: 3,
      referenceFrame: 'as a senior JavaScript developer',
    })

    render(
      <ExplanationPreferencesPanel
        initial={{ depth: 3, referenceFrame: null }}
      />,
    )

    await user.type(
      screen.getByLabelText('Reference frame (optional)'),
      '  as a senior JavaScript developer  ',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateMock).toHaveBeenCalledWith({
      data: { referenceFrame: 'as a senior JavaScript developer' },
    })
  })

  it('clears the reference frame when saved empty', async () => {
    const user = userEvent.setup()
    updateMock.mockResolvedValue({ depth: 3, referenceFrame: null })

    render(
      <ExplanationPreferencesPanel
        initial={{
          depth: 3,
          referenceFrame: 'as a senior JavaScript developer',
        }}
      />,
    )

    await user.clear(screen.getByLabelText('Reference frame (optional)'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateMock).toHaveBeenCalledWith({
      data: { referenceFrame: null },
    })
  })

  it('shows a failure message when saving fails', async () => {
    const user = userEvent.setup()
    updateMock.mockRejectedValue(new Error('server unavailable'))

    render(
      <ExplanationPreferencesPanel
        initial={{ depth: 3, referenceFrame: null }}
      />,
    )

    await user.click(screen.getByRole('button', { name: '4 · Advanced' }))

    expect(
      await screen.findByText(/Could not save the explanation depth/),
    ).toBeInTheDocument()
  })
})
