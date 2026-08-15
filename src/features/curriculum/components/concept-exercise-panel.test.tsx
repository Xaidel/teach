// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../curriculum.functions', () => ({
  generateStepExerciseFn: vi.fn(),
}))

vi.mock('../../exercise/exercise.functions', () => ({
  submitExerciseFn: vi.fn(),
  requestHintFn: vi.fn(),
}))

import { generateStepExerciseFn } from '../curriculum.functions'
import {
  requestHintFn,
  submitExerciseFn,
} from '../../exercise/exercise.functions'
import type { Exercise } from '../../exercise/exercise.schema'
import { ConceptExercisePanel } from './concept-exercise-panel'

const generateStepExerciseMock = vi.mocked(generateStepExerciseFn)
const submitExerciseMock = vi.mocked(submitExerciseFn)
const requestHintMock = vi.mocked(requestHintFn)

const EXERCISE: Exercise = {
  id: 'e1',
  slug: 'rust-is-even',
  language: 'rust',
  title: 'Is it even?',
  prompt: 'Implement is_even.',
  starterCode: 'pub fn is_even(n: u32) -> bool {\n    false\n}\n',
  guidance: 'guided',
  sampleTests: null,
}

const PANEL_PROPS = {
  language: 'rust' as const,
  conceptSlug: 'rust.introduction',
  guidance: 'guided' as const,
}

describe('ConceptExercisePanel', () => {
  afterEach(() => {
    generateStepExerciseMock.mockReset()
    submitExerciseMock.mockReset()
    requestHintMock.mockReset()
  })

  it('generates the exercise automatically and renders the editor', async () => {
    generateStepExerciseMock.mockResolvedValue({
      kind: 'generated',
      exercise: EXERCISE,
      conceptSlug: 'rust.introduction',
      targetConcepts: ['rust.introduction'],
      prerequisites: [],
      estimatedMinutes: 5,
      constraints: [],
      preflight: {
        attemptNumber: 1,
        passed: true,
        checks: [{ name: 'reference_passes', passed: true }],
      },
      simplified: false,
    })

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={null}
        onPassed={vi.fn()}
      />,
    )

    expect(await screen.findByLabelText('Your solution')).toHaveValue(
      EXERCISE.starterCode,
    )
    expect(generateStepExerciseMock).toHaveBeenCalledExactlyOnceWith({
      data: {
        language: 'rust',
        conceptSlug: 'rust.introduction',
        guidance: 'guided',
      },
    })
  })

  it('renders an already-banked exercise directly, without generating a new one', () => {
    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={EXERCISE}
        onPassed={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Your solution')).toHaveValue(
      EXERCISE.starterCode,
    )
    expect(generateStepExerciseMock).not.toHaveBeenCalled()
  })

  it('shows the pass banner and calls onPassed once the attempt passes', async () => {
    const user = userEvent.setup()
    const onPassed = vi.fn()
    submitExerciseMock.mockResolvedValue({
      attemptId: 'a1',
      result: {
        passed: true,
        tests: [{ name: 'handles_zero', status: 'passed' }],
      },
      hint: null,
      stage2Review: null,
    })

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={EXERCISE}
        onPassed={onPassed}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )

    expect(await screen.findByText(/Passed — all 1 test/)).toBeInTheDocument()
    expect(screen.getByText('passed')).toBeInTheDocument()
    expect(onPassed).toHaveBeenCalledOnce()
  })

  it('offers a hint after a failed submission', async () => {
    const user = userEvent.setup()
    submitExerciseMock.mockResolvedValue({
      attemptId: 'a1',
      result: {
        passed: false,
        tests: [{ name: 'handles_zero', status: 'failed' }],
      },
      hint: null,
      stage2Review: null,
    })
    requestHintMock.mockResolvedValue({
      hint: { level: 0, content: 'Think about the remainder operator.' },
    })

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={EXERCISE}
        onPassed={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )
    expect(await screen.findByText(/Failed — 1 of 1 test/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Get a hint' }))

    expect(requestHintMock).toHaveBeenCalledExactlyOnceWith({
      data: { attemptId: 'a1', action: 'next' },
    })
    expect(
      await screen.findByText('Think about the remainder operator.'),
    ).toBeInTheDocument()
  })

  it('shows sample tests before submission when the exercise has them', () => {
    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={{
          ...EXERCISE,
          sampleTests: [
            { input: 'is_even(4)', expected: 'true' },
            { input: 'is_even(3)', expected: 'false' },
          ],
        }}
        onPassed={vi.fn()}
      />,
    )

    expect(screen.getByText('is_even(4) → true')).toBeInTheDocument()
    expect(screen.getByText('is_even(3) → false')).toBeInTheDocument()
    expect(
      screen.queryByText('Submit your code to see test results.'),
    ).not.toBeInTheDocument()
  })

  it('replaces sample tests with the real results once submitted', async () => {
    const user = userEvent.setup()
    submitExerciseMock.mockResolvedValue({
      attemptId: 'a1',
      result: {
        passed: true,
        tests: [{ name: 'handles_zero', status: 'passed' }],
      },
      hint: null,
      stage2Review: null,
    })

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={{
          ...EXERCISE,
          sampleTests: [{ input: 'is_even(4)', expected: 'true' }],
        }}
        onPassed={vi.fn()}
      />,
    )

    expect(screen.getByText('is_even(4) → true')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Submit for evaluation' }),
    )

    expect(await screen.findByText('handles_zero')).toBeInTheDocument()
    expect(screen.queryByText('is_even(4) → true')).not.toBeInTheDocument()
  })

  it('falls back to the placeholder when the exercise has no sample tests', () => {
    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={EXERCISE}
        onPassed={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Submit your code to see test results.'),
    ).toBeInTheDocument()
  })

  it('disables hints for an independent exercise', () => {
    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={{ ...EXERCISE, guidance: 'independent' }}
        guidance="independent"
        onPassed={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'Independent exercise — hints are disabled for this step.',
      ),
    ).toBeInTheDocument()
  })

  it('retries generation through the Try again button', async () => {
    const user = userEvent.setup()
    generateStepExerciseMock.mockRejectedValueOnce(new Error('boom'))
    generateStepExerciseMock.mockResolvedValueOnce({
      kind: 'generated',
      exercise: EXERCISE,
      conceptSlug: 'rust.introduction',
      targetConcepts: ['rust.introduction'],
      prerequisites: [],
      estimatedMinutes: 5,
      constraints: [],
      preflight: {
        attemptNumber: 1,
        passed: true,
        checks: [{ name: 'reference_passes', passed: true }],
      },
      simplified: false,
    })

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={null}
        onPassed={vi.fn()}
      />,
    )

    await screen.findByText('boom')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Your solution')).toHaveValue(
      EXERCISE.starterCode,
    )
    expect(generateStepExerciseMock).toHaveBeenCalledTimes(2)
  })

  it('calls onReady once generation settles when nothing was banked yet', async () => {
    generateStepExerciseMock.mockResolvedValue({
      kind: 'generated',
      exercise: EXERCISE,
      conceptSlug: 'rust.introduction',
      targetConcepts: ['rust.introduction'],
      prerequisites: [],
      estimatedMinutes: 5,
      constraints: [],
      preflight: {
        attemptNumber: 1,
        passed: true,
        checks: [{ name: 'reference_passes', passed: true }],
      },
      simplified: false,
    })
    const onReady = vi.fn()

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={null}
        onPassed={vi.fn()}
        onReady={onReady}
      />,
    )

    await screen.findByLabelText('Your solution')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('calls onReady on a failed generation too, so the loading screen never gets stuck', async () => {
    generateStepExerciseMock.mockRejectedValue(new Error('boom'))
    const onReady = vi.fn()

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={null}
        onPassed={vi.fn()}
        onReady={onReady}
      />,
    )

    await screen.findByText('boom')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('calls onReady immediately when an exercise is already banked, without generating', () => {
    const onReady = vi.fn()

    render(
      <ConceptExercisePanel
        {...PANEL_PROPS}
        exercise={EXERCISE}
        onPassed={vi.fn()}
        onReady={onReady}
      />,
    )

    expect(onReady).toHaveBeenCalledOnce()
    expect(generateStepExerciseMock).not.toHaveBeenCalled()
  })
})
