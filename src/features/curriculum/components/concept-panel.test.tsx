// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../curriculum.functions', () => ({
  generateLessonFn: vi.fn(),
}))

vi.mock('#/features/learners/learners.functions', () => ({
  updateExplanationPreferencesFn: vi.fn(),
}))

import { generateLessonFn } from '../curriculum.functions'
import { ConceptPanel } from './concept-panel'

const generateLessonMock = vi.mocked(generateLessonFn)

const PANEL_PROPS = {
  language: 'rust' as const,
  conceptSlug: 'rust.introduction',
  position: 1,
  difficulty: 1,
  mastery: 'unknown',
  status: 'available' as const,
  explanationPreferences: { depth: 3, referenceFrame: null },
}

describe('ConceptPanel', () => {
  afterEach(() => {
    generateLessonMock.mockReset()
  })

  it('generates the lesson automatically on arrival and renders it', async () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation: 'Rust is a systems language with an ownership model.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    expect(
      await screen.findByText(
        'Rust is a systems language with an ownership model.',
      ),
    ).toBeInTheDocument()
    expect(generateLessonMock).toHaveBeenCalledExactlyOnceWith({
      data: { language: 'rust', conceptSlug: 'rust.introduction' },
    })
  })

  it('renders the concept identity and status badges', () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation: 'Explanation.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    expect(
      screen.getByRole('heading', { name: 'Step 1 — rust.introduction' }),
    ).toBeInTheDocument()
    expect(screen.getByText('difficulty 1')).toBeInTheDocument()
    expect(screen.getByText('mastery: unknown')).toBeInTheDocument()
    expect(screen.getByText('available')).toBeInTheDocument()
  })

  it('shows a safe error when lesson generation fails', async () => {
    generateLessonMock.mockRejectedValue(new Error('boom'))

    render(<ConceptPanel {...PANEL_PROPS} />)

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('retries generation through the Try again button', async () => {
    const user = userEvent.setup()
    generateLessonMock.mockRejectedValueOnce(new Error('boom'))
    generateLessonMock.mockResolvedValueOnce({
      concept: 'rust.introduction',
      explanation: 'It works the second time.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    await screen.findByText('boom')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText('It works the second time.'),
    ).toBeInTheDocument()
    expect(generateLessonMock).toHaveBeenCalledTimes(2)
  })

  it('calls onReady once the first generation settles, whether it succeeds or fails', async () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation: 'Explanation.',
    })
    const onReady = vi.fn()

    render(<ConceptPanel {...PANEL_PROPS} onReady={onReady} />)

    await screen.findByText('Explanation.')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('calls onReady on a failed first generation too, so the loading screen never gets stuck', async () => {
    generateLessonMock.mockRejectedValue(new Error('boom'))
    const onReady = vi.fn()

    render(<ConceptPanel {...PANEL_PROPS} onReady={onReady} />)

    await screen.findByText('boom')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('does not call onReady again for a regeneration after the first has settled', async () => {
    const user = userEvent.setup()
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation: 'Explanation.',
    })
    const onReady = vi.fn()

    render(<ConceptPanel {...PANEL_PROPS} onReady={onReady} />)

    await screen.findByText('Explanation.')
    expect(onReady).toHaveBeenCalledOnce()

    await user.click(screen.getByLabelText('Adjust explanation level'))
    await user.click(screen.getByLabelText('Explain like...'))
    await user.type(screen.getByLabelText('Explain like...'), 'a pirate')
    await user.click(screen.getByRole('button', { name: 'Go' }))

    await screen.findByText('Explanation.')
    expect(onReady).toHaveBeenCalledOnce()
  })
})
