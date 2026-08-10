// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../exercise.functions', () => ({
  submitExerciseFn: vi.fn(),
}))

import { submitExerciseFn } from '../exercise.functions'
import type { Exercise } from '../exercise.schema'
import { ExerciseEditor } from './exercise-editor'

const submitMock = vi.mocked(submitExerciseFn)

const EXERCISE: Exercise = {
  id: 'e1',
  slug: 'rust-is-even',
  language: 'rust',
  title: 'Is it even?',
  prompt: 'Implement is_even.',
  starterCode: 'pub fn is_even(n: u32) -> bool {\n    false\n}\n',
}

describe('ExerciseEditor', () => {
  it('prefills the editor with starter code and submits it', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({ passed: true, tests: [] })

    render(<ExerciseEditor exercise={EXERCISE} />)

    const editor = screen.getByLabelText('Your solution')
    expect(editor).toHaveValue(EXERCISE.starterCode)

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )

    expect(submitMock).toHaveBeenCalledWith({
      data: { exerciseId: 'e1', code: EXERCISE.starterCode },
    })
    expect(await screen.findByText(/Passed — all 0 tests/)).toBeInTheDocument()
  })

  it('shows the result after editing the code', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      passed: false,
      tests: [{ name: 'handles_zero', status: 'failed' }],
    })

    render(<ExerciseEditor exercise={EXERCISE} />)

    const editedCode = 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }'
    fireEvent.change(screen.getByLabelText('Your solution'), {
      target: { value: editedCode },
    })
    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )

    expect(submitMock).toHaveBeenCalledWith({
      data: { exerciseId: 'e1', code: editedCode },
    })
    expect(await screen.findByText(/Failed — 1 of 1 test/)).toBeInTheDocument()
  })

  it('shows a failure message when the submission cannot be evaluated', async () => {
    const user = userEvent.setup()
    submitMock.mockRejectedValue(new Error('server unavailable'))

    render(<ExerciseEditor exercise={EXERCISE} />)

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )

    expect(
      await screen.findByText(/could not be evaluated/),
    ).toBeInTheDocument()
  })
})
