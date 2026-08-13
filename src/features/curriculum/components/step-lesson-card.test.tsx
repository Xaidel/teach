// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('../curriculum.functions', () => ({
  generateLessonFn: vi.fn(),
}))

import { generateLessonFn } from '../curriculum.functions'
import { StepLessonCard } from './step-lesson-card'

const generateLessonMock = vi.mocked(generateLessonFn)

describe('StepLessonCard', () => {
  beforeEach(() => {
    generateLessonMock.mockReset()
  })

  it('generates and shows the lesson on demand', async () => {
    const user = userEvent.setup()
    generateLessonMock.mockResolvedValue({
      concept: 'test.rust.borrowing',
      explanation: 'Borrowing lets code read without taking ownership.',
    })

    render(<StepLessonCard language="rust" conceptSlug="test.rust.borrowing" />)

    await user.click(screen.getByRole('button', { name: 'Generate lesson' }))

    expect(
      await screen.findByText(
        'Borrowing lets code read without taking ownership.',
      ),
    ).toBeInTheDocument()
    expect(generateLessonMock).toHaveBeenCalledWith({
      data: { language: 'rust', conceptSlug: 'test.rust.borrowing' },
    })
  })

  it('shows a safe error when lesson generation fails', async () => {
    const user = userEvent.setup()
    generateLessonMock.mockRejectedValue(
      new Error('The lesson could not be generated. Try again.'),
    )

    render(<StepLessonCard language="rust" conceptSlug="test.rust.borrowing" />)

    await user.click(screen.getByRole('button', { name: 'Generate lesson' }))

    expect(
      await screen.findByText(/could not be generated/),
    ).toBeInTheDocument()
  })
})
