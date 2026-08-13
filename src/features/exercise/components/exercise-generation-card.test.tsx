// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('../exercise.functions', () => ({
  generateExerciseFn: vi.fn(),
}))

import { generateExerciseFn } from '../exercise.functions'
import type { GenerateExerciseOutput } from '../exercise-generation.schema'
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

const CONCEPT_AT_THRESHOLD: GenerationConcept = {
  id: 'c4',
  slug: 'test.rust.traits',
  difficulty: 2,
  preFlight: { conceptId: 'c4', totalAttempts: 5, failedAttempts: 2 },
}

/** A fully-verified generated outcome as the card's mocked fn returns it. */
const GENERATED_OUTCOME: GenerateExerciseOutput = {
  kind: 'generated',
  exercise: {
    id: 'e1',
    slug: 'rust-test-rust-borrowing-a1b2c3d4',
    language: 'rust',
    title: 'Borrow or move?',
    prompt: 'Implement first.',
    starterCode: 'pub fn first(v: Vec<u32>) -> u32 { v[0] }',
  },
  conceptSlug: 'test.rust.borrowing',
  targetConcepts: ['test.rust.borrowing'],
  prerequisites: [],
  estimatedMinutes: 8,
  constraints: ['std_only'],
  preflight: {
    attemptNumber: 1,
    passed: true,
    checks: [
      { name: 'reference_passes', passed: true },
      { name: 'broken_state_fails', passed: true },
      { name: 'failure_matches_concept', passed: true },
    ],
  },
  simplified: false,
}

describe('ExerciseGenerationCard', () => {
  const generateExerciseFnMock = vi.mocked(generateExerciseFn)

  beforeEach(() => {
    generateExerciseFnMock.mockReset()
  })
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

  it('surfaces the quality signal exactly at the repeated-failure threshold (2/5)', async () => {
    const user = userEvent.setup()
    render(
      <ExerciseGenerationCard
        concepts={[CONCEPT_CLEAN, CONCEPT_AT_THRESHOLD]}
        language="rust"
      />,
    )

    expect(screen.queryByText(/Quality signal/)).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Target concept' }),
      'test.rust.traits',
    )

    expect(
      screen.getByText(
        /2 of the 5 Pre-Flight runs for this concept failed; repeated failures mean generation has been unreliable here/,
      ),
    ).toBeInTheDocument()
  })

  it('generates a non-adversarial exercise by default', async () => {
    const user = userEvent.setup()
    generateExerciseFnMock.mockResolvedValue(GENERATED_OUTCOME)
    render(
      <ExerciseGenerationCard concepts={[CONCEPT_CLEAN]} language="rust" />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Generate rust exercise' }),
    )

    expect(generateExerciseFn).toHaveBeenCalledWith({
      data: {
        language: 'rust',
        conceptSlug: 'test.rust.borrowing',
        adversarial: false,
      },
    })
    expect(screen.getByText(/Verified — Borrow or move\?/)).toBeInTheDocument()
  })

  it('targets an adversarial exercise when the toggle is checked', async () => {
    const user = userEvent.setup()
    generateExerciseFnMock.mockResolvedValue(GENERATED_OUTCOME)
    render(
      <ExerciseGenerationCard concepts={[CONCEPT_CLEAN]} language="rust" />,
    )

    await user.click(screen.getByRole('checkbox', { name: /Adversarial/ }))
    await user.click(
      screen.getByRole('button', { name: 'Generate rust exercise' }),
    )

    expect(generateExerciseFn).toHaveBeenCalledWith({
      data: {
        language: 'rust',
        conceptSlug: 'test.rust.borrowing',
        adversarial: true,
      },
    })
  })

  it('renders the declared defect of a verified adversarial generation', async () => {
    const user = userEvent.setup()
    generateExerciseFnMock.mockResolvedValue({
      ...GENERATED_OUTCOME,
      defect: {
        kind: 'ownership',
        description: 'first consumes the vector instead of borrowing it',
        location: 'first',
        expectedBehavior:
          'first returns the first element while leaving the vector usable',
      },
    })
    render(
      <ExerciseGenerationCard concepts={[CONCEPT_CLEAN]} language="rust" />,
    )

    await user.click(screen.getByRole('checkbox', { name: /Adversarial/ }))
    await user.click(
      screen.getByRole('button', { name: 'Generate rust exercise' }),
    )

    expect(
      screen.getByText(
        /adversarial \(ownership\) first consumes the vector instead of borrowing it/,
      ),
    ).toBeInTheDocument()
  })

  it('renders the adversarial label when the fallback serves a stored adversarial row', async () => {
    const user = userEvent.setup()
    generateExerciseFnMock.mockResolvedValue({
      kind: 'verified-fallback',
      exercise: {
        id: 'e2',
        slug: 'rust-test-rust-borrowing-f00df00d',
        language: 'rust',
        title: 'Seeded adversarial',
        prompt: 'Find and fix the defect.',
        starterCode: 'pub fn seeded() {}',
      },
      conceptSlug: 'test.rust.borrowing',
      targetConcepts: ['test.rust.borrowing'],
      constraints: ['std_only'],
      defect: {
        kind: 'ownership',
        description: 'first consumes the vector instead of borrowing it',
        location: 'first',
        expectedBehavior:
          'first returns the first element while leaving the vector usable',
      },
    })
    render(
      <ExerciseGenerationCard concepts={[CONCEPT_CLEAN]} language="rust" />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Generate rust exercise' }),
    )

    expect(
      screen.getByText(
        /Fell back to a previously verified exercise — Seeded adversarial — adversarial \(ownership\) first consumes the vector instead of borrowing it/,
      ),
    ).toBeInTheDocument()
  })

  it('renders no adversarial label when the fallback serves a non-adversarial row', async () => {
    const user = userEvent.setup()
    generateExerciseFnMock.mockResolvedValue({
      kind: 'verified-fallback',
      exercise: {
        id: 'e3',
        slug: 'rust-test-rust-borrowing-beefbeef',
        language: 'rust',
        title: 'Seeded implement',
        prompt: 'Do the thing.',
        starterCode: 'pub fn seeded() {}',
      },
      conceptSlug: 'test.rust.borrowing',
      targetConcepts: ['test.rust.borrowing'],
      constraints: ['std_only'],
    })
    render(
      <ExerciseGenerationCard concepts={[CONCEPT_CLEAN]} language="rust" />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Generate rust exercise' }),
    )

    expect(
      screen.getByText(
        /Fell back to a previously verified exercise — Seeded implement/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/adversarial \(/)).not.toBeInTheDocument()
  })
})
