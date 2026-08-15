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

  it('renders fenced code from the explanation as a code block, not inline text', async () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation:
        'A borrow lets you read a value without taking ownership.\n\n```rust\nlet borrowed = &value;\n```\n\nThe original binding stays valid.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    expect(
      await screen.findByText(
        'A borrow lets you read a value without taking ownership.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The original binding stays valid.'),
    ).toBeInTheDocument()

    const code = screen.getByText('let borrowed = &value;')
    expect(code.tagName).toBe('CODE')
    expect(code.closest('pre')).toBeInTheDocument()
  })

  it('renders inline single-backtick spans as code, not literal backticks', async () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation:
        'It defines a `main` function, the entry point. Call `println!` to print.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    const code = await screen.findByText('main')
    expect(code.tagName).toBe('CODE')
    expect(screen.getByText('println!').tagName).toBe('CODE')
    expect(screen.queryByText(/`main`/)).not.toBeInTheDocument()
  })

  it('renders headings and list items with their semantic hierarchy', async () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation:
        '## Ownership\n\nRust tracks who owns each value.\n\n### Rules\n\n- Each value has one owner\n- The owner can move or borrow it\n\nThat keeps memory safe without a garbage collector.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    expect(
      await screen.findByRole('heading', { name: 'Ownership', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Rules', level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Each value has one owner')).toBeInTheDocument()
    expect(
      screen.getByText('The owner can move or borrow it'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('That keeps memory safe without a garbage collector.'),
    ).toBeInTheDocument()
  })

  it('renders **bold** spans as emphasized text, not literal asterisks', async () => {
    generateLessonMock.mockResolvedValue({
      concept: 'rust.introduction',
      explanation: 'A **borrow** lets you read a value without taking it.',
    })

    render(<ConceptPanel {...PANEL_PROPS} />)

    const bold = await screen.findByText('borrow')
    expect(bold.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*borrow\*\*/)).not.toBeInTheDocument()
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

  it('hides the current explanation and shows loading text while regenerating from the popover', async () => {
    const user = userEvent.setup()
    generateLessonMock.mockResolvedValueOnce({
      concept: 'rust.introduction',
      explanation: 'First explanation.',
    })
    let resolveSecond: (lesson: {
      concept: string
      explanation: string
    }) => void = () => {
      throw new Error('resolveSecond called before the promise was set up')
    }
    generateLessonMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      }),
    )

    render(<ConceptPanel {...PANEL_PROPS} />)
    await screen.findByText('First explanation.')

    await user.click(screen.getByLabelText('Adjust explanation level'))
    await user.click(screen.getByLabelText('Explain like...'))
    await user.type(screen.getByLabelText('Explain like...'), 'a pirate')
    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(screen.getByRole('status')).toHaveTextContent(
      'Generating the lesson…',
    )
    expect(screen.queryByText('First explanation.')).not.toBeInTheDocument()

    resolveSecond({
      concept: 'rust.introduction',
      explanation: 'Second explanation.',
    })
    expect(await screen.findByText('Second explanation.')).toBeInTheDocument()
  })

  it('restores the previous explanation and reports it as not possible when regeneration fails', async () => {
    const user = userEvent.setup()
    generateLessonMock.mockResolvedValueOnce({
      concept: 'rust.introduction',
      explanation: 'First explanation.',
    })
    generateLessonMock.mockRejectedValueOnce(new Error('boom'))

    render(<ConceptPanel {...PANEL_PROPS} />)
    await screen.findByText('First explanation.')

    await user.click(screen.getByLabelText('Adjust explanation level'))
    await user.click(screen.getByLabelText('Explain like...'))
    await user.type(screen.getByLabelText('Explain like...'), 'a pirate')
    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(
      await screen.findByText(
        "That's not possible right now — showing the previous explanation.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('First explanation.')).toBeInTheDocument()
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
