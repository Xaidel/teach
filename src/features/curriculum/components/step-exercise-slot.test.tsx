// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('../curriculum.functions', () => ({
  generateStepExerciseFn: vi.fn(),
}))

vi.mock('../../exercise/components/exercise-editor', () => ({
  ExerciseEditor: ({ exercise }: { exercise: { title: string } }) => (
    <div>editor:{exercise.title}</div>
  ),
}))

import { generateStepExerciseFn } from '../curriculum.functions'
import type { GenerateExerciseOutput } from '../../exercise/exercise-generation.schema'
import { StepExerciseSlot } from './step-exercise-slot'

const generateStepExerciseMock = vi.mocked(generateStepExerciseFn)

const GENERATED: GenerateExerciseOutput = {
  kind: 'generated',
  exercise: {
    id: 'e1',
    slug: 'rust-test-rust-borrowing-a1b2c3d4',
    language: 'rust',
    title: 'Borrow or move?',
    prompt: 'Implement first.',
    starterCode: 'pub fn first(v: Vec<u32>) -> u32 { v[0] }',
    guidance: 'guided',
  },
  conceptSlug: 'test.rust.borrowing',
  targetConcepts: ['test.rust.borrowing'],
  prerequisites: [],
  estimatedMinutes: 8,
  constraints: ['std_only'],
  preflight: {
    attemptNumber: 1,
    passed: true,
    checks: [{ name: 'reference_passes', passed: true }],
  },
  simplified: false,
}

const SLOT_PROPS = {
  language: 'rust' as const,
  conceptSlug: 'test.rust.borrowing',
  description: 'A first exercise with hints available.',
}

describe('StepExerciseSlot', () => {
  beforeEach(() => {
    generateStepExerciseMock.mockReset()
  })

  it('generates a guided exercise and renders it in the editor', async () => {
    const user = userEvent.setup()
    generateStepExerciseMock.mockResolvedValue(GENERATED)

    render(
      <StepExerciseSlot {...SLOT_PROPS} exercise={null} guidance="guided" />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Generate guided exercise' }),
    )

    expect(
      await screen.findByText('editor:Borrow or move?'),
    ).toBeInTheDocument()
    expect(generateStepExerciseMock).toHaveBeenCalledWith({
      data: {
        language: 'rust',
        conceptSlug: 'test.rust.borrowing',
        guidance: 'guided',
      },
    })
  })

  it('labels a verified-fallback generation', async () => {
    const user = userEvent.setup()
    generateStepExerciseMock.mockResolvedValue({
      kind: 'verified-fallback',
      exercise: GENERATED.exercise,
      conceptSlug: 'test.rust.borrowing',
      targetConcepts: ['test.rust.borrowing'],
      constraints: ['std_only'],
    })

    render(
      <StepExerciseSlot
        {...SLOT_PROPS}
        exercise={null}
        guidance="independent"
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Generate independent exercise' }),
    )

    expect(
      await screen.findByText(/Fell back to a previously verified exercise/),
    ).toBeInTheDocument()
  })

  it('shows a safe error when generation fails', async () => {
    const user = userEvent.setup()
    generateStepExerciseMock.mockRejectedValue(
      new Error(
        "This step's prerequisites are not all Practiced yet — complete the earlier steps first.",
      ),
    )

    render(
      <StepExerciseSlot {...SLOT_PROPS} exercise={null} guidance="guided" />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Generate guided exercise' }),
    )

    expect(
      await screen.findByText(/prerequisites are not all Practiced yet/),
    ).toBeInTheDocument()
  })
})
