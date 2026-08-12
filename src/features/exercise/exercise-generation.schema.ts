import { z } from 'zod'

import type { PreFlightCheck } from '#/db/schema'
import { CONCEPT_SLUG_PATTERN } from '#/lib/concept-graph'
import { SANDBOX_LANGUAGES } from '#/lib/sandbox/types'

import type { Exercise } from './exercise.schema'

/**
 * The languages exercise generation is enabled for. Issue #8 ships Rust;
 * Go and Python arrive with tickets #19/#20.
 */
export const EXERCISE_GENERATION_LANGUAGES = ['rust'] as const

export type ExerciseGenerationLanguage =
  (typeof EXERCISE_GENERATION_LANGUAGES)[number]

/** Narrowing guard for generation-language values from untrusted input. */
export function isExerciseGenerationLanguage(
  value: string,
): value is ExerciseGenerationLanguage {
  return (EXERCISE_GENERATION_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Input to the generation flow: the language and the Concept Graph concept
 * the exercise must target. The concept must already exist for that
 * language — the AI Teacher Engine never invents concepts outside the
 * graph.
 */
export const GenerateExerciseForConceptInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
})

export type GenerateExerciseForConceptInput = z.infer<
  typeof GenerateExerciseForConceptInputSchema
>

/**
 * Outcome of one generation + Pre-Flight cycle (issue #8): the persisted,
 * verified exercise plus the generation metadata and the Pre-Flight
 * verdict. `targetConcepts` are the slugs actually joined to persisted
 * concepts (drafts referencing concepts outside the graph are dropped).
 * `prerequisites` surfaces the model-declared prerequisite slugs at the
 * feature boundary so they are not silently dropped — the Concept Graph's
 * edges already model prerequisites structurally, and this field lets
 * callers compare the model's claim against the graph (issue #91).
 */
export type GenerateExerciseOutput = {
  exercise: Exercise
  conceptSlug: string
  targetConcepts: string[]
  prerequisites: string[]
  estimatedMinutes: number
  constraints: string[]
  preflight: {
    attemptNumber: number
    passed: true
    checks: PreFlightCheck[]
  }
}

/** Stable public exercise-generation error codes. */
export type GenerationErrorCode =
  | 'EXERCISE_GENERATION_UNSUPPORTED'
  | 'CONCEPT_NOT_FOUND'
  | 'EXERCISE_GENERATION_FAILED'
  | 'EXERCISE_GENERATION_INVALID'
  | 'PREFLIGHT_FAILED'

const GENERATION_ERROR_MESSAGES: Record<GenerationErrorCode, string> = {
  EXERCISE_GENERATION_UNSUPPORTED:
    'Exercise generation is not enabled for this language yet.',
  CONCEPT_NOT_FOUND: 'The selected concept does not exist in this language.',
  EXERCISE_GENERATION_FAILED: 'The exercise could not be generated. Try again.',
  EXERCISE_GENERATION_INVALID:
    'The generated exercise failed validation and was discarded. Try again.',
  PREFLIGHT_FAILED:
    'Pre-Flight Validation failed; no exercise was saved. Try a different concept.',
}

/** Safe error surfaced by the exercise-generation server boundary. */
export class GenerationError extends Error {
  readonly code: GenerationErrorCode

  /** Creates a safe exercise-generation feature error. */
  constructor(code: GenerationErrorCode) {
    super(GENERATION_ERROR_MESSAGES[code])
    this.name = 'GenerationError'
    this.code = code
  }
}
