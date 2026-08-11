// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../exercise.functions', () => ({
  requestHintFn: vi.fn(),
  submitExerciseFn: vi.fn(),
}))

import { requestHintFn, submitExerciseFn } from '../exercise.functions'
import type { Exercise } from '../exercise.schema'
import { ExerciseEditor } from './exercise-editor'

const submitMock = vi.mocked(submitExerciseFn)
const requestHintMock = vi.mocked(requestHintFn)

const EXERCISE: Exercise = {
  id: 'e1',
  slug: 'rust-is-even',
  language: 'rust',
  title: 'Is it even?',
  prompt: 'Implement is_even.',
  starterCode: 'pub fn is_even(n: u32) -> bool {\n    false\n}\n',
}

describe('ExerciseEditor', () => {
  beforeEach(() => {
    submitMock.mockReset()
    requestHintMock.mockReset()
  })

  it('prefills the editor with starter code and submits it', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      submissionId: 's1',
      result: { passed: true, tests: [] },
      hint: null,
    })

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
      submissionId: 's1',
      result: {
        passed: false,
        tests: [{ name: 'handles_zero', status: 'failed' }],
      },
      hint: null,
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

  it('shows the socratic hint when stage 1 fails and a hint is produced', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      submissionId: 's1',
      result: {
        passed: false,
        tests: [{ name: 'handles_zero', status: 'failed' }],
      },
      hint: { level: 0, content: 'What should is_even return when n is even?' },
    })

    render(<ExerciseEditor exercise={EXERCISE} />)

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )

    expect(
      await screen.findByText(/What should is_even return when n is even/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Your hint · Level 0/)).toBeInTheDocument()
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

  it('lets the learner request the next hint level for the attempt', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      submissionId: 's1',
      result: {
        passed: false,
        tests: [{ name: 'handles_zero', status: 'failed' }],
      },
      hint: { level: 0, content: 'Start by considering zero.' },
    })
    requestHintMock.mockResolvedValue({
      hint: { level: 1, content: 'Check the remainder operation.' },
    })

    render(<ExerciseEditor exercise={EXERCISE} />)

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Request Level 1' }),
    )

    expect(requestHintMock).toHaveBeenCalledWith({
      data: { submissionId: 's1', action: 'next' },
    })
    expect(
      await screen.findByText('Check the remainder operation.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Your hint · Level 1/)).toBeInTheDocument()
  })

  it('requires a separate action to request the full solution', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({
      submissionId: 's1',
      result: {
        passed: false,
        tests: [{ name: 'handles_zero', status: 'failed' }],
      },
      hint: {
        level: 4,
        content: 'Use the remainder to complete the function.',
      },
    })
    requestHintMock.mockResolvedValue({
      hint: {
        level: 5,
        content: 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }',
      },
    })

    render(<ExerciseEditor exercise={EXERCISE} />)

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )
    expect(
      await screen.findByRole('button', {
        name: 'Show full solution · Level 5',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Request Level 5' }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Show full solution · Level 5' }),
    )

    expect(requestHintMock).toHaveBeenCalledWith({
      data: { submissionId: 's1', action: 'full_solution' },
    })
    expect(
      await screen.findByText('pub fn is_even(n: u32) -> bool { n % 2 == 0 }', {
        selector: 'p',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Your hint · Level 5/)).toBeInTheDocument()
  })
})
