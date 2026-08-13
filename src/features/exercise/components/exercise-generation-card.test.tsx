// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('../exercise.functions', () => ({
  generateExerciseFn: vi.fn(),
}))

import {
  ExerciseGenerationCard,
  type GenerationConcept,
} from './exercise-generation-card'

const CONCEPT_CLEAN: GenerationConcept = {
  id: 'c1',
  slug: 'test.rust.borrowing',
  difficulty: 2,
  preFlight: null,
}

const CONCEPT_REPEATED_FAILURES: GenerationConcept = {
  id: 'c2',
  slug: 'test.rust.ownership',
  difficulty: 3,
  preFlight: { conceptId: 'c2', totalAttempts: 5, failedAttempts: 3 },
}

const CONCEPT_SINGLE_FAILURE: GenerationConcept = {
  id: 'c3',
  slug: 'test.rust.lifetimes',
  difficulty: 2,
  preFlight: { conceptId: 'c3', totalAttempts: 3, failedAttempts: 1 },
}

describe('ExerciseGenerationCard', () => {
  it('surfaces repeated Pre-Flight failures on the selected concept as a quality signal (SPEC story 35)', async () => {
    const user = userEvent.setup()
    render(
      <ExerciseGenerationCard
        concepts={[CONCEPT_CLEAN, CONCEPT_REPEATED_FAILURES]}
        language="rust"
      />,
    )

    expect(screen.queryByText(/Quality signal/)).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Target concept' }),
      'test.rust.ownership',
    )

    expect(
      screen.getByText(
        /3 of the 5 Pre-Flight runs for this concept failed; repeated failures mean generation has been unreliable here/,
      ),
    ).toBeInTheDocument()
  })

  it('shows no quality signal for a single failure or a clean concept', async () => {
    const user = userEvent.setup()
    render(
      <ExerciseGenerationCard
        concepts={[CONCEPT_CLEAN, CONCEPT_SINGLE_FAILURE]}
        language="rust"
      />,
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Target concept' }),
      'test.rust.lifetimes',
    )

    expect(screen.queryByText(/Quality signal/)).not.toBeInTheDocument()
  })
})
