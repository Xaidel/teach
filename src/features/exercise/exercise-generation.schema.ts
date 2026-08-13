import { z } from 'zod'

import type { PreFlightCheck } from '#/db/schema'
import type { ExerciseDefect } from '#/lib/ai/schemas'
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
 * graph. `adversarial` targets an adversarial (debug-mode) exercise whose
 * starterCode intentionally contains one known, declared defect the
 * learner must find and fix, gated by the same Pre-Flight Validation as
 * any other exercise (SPEC stories 51-52, PRD §20, issue #11); when set,
 * the persisted row carries `mode = 'debug'` and the generation output
 * declares the defect.
 */
export const GenerateExerciseForConceptInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
  adversarial: z.boolean().optional(),
})

export type GenerateExerciseForConceptInput = z.infer<
  typeof GenerateExerciseForConceptInputSchema
>

/**
 * The 3-attempt cap of the Pre-Flight retry loop (SPEC story 33, PRD §5.2,
 * issue #9). After this many failed attempts the circuit breaker trips and
 * the fallback strategy runs (SPEC story 34).
 */
export const MAX_PREFLIGHT_ATTEMPTS = 3

/**
 * The attempt number of the circuit-breaker's terminal fallback
 * regeneration with a simplified constraint set (SPEC story 34, PRD §5.2):
 * one run beyond the 3-attempt cap, never looped further. Mirrors the
 * `pre_flight_attempts.attempt_number` check constraint (ADR-0010).
 */
export const SIMPLIFIED_FALLBACK_ATTEMPT_NUMBER = MAX_PREFLIGHT_ATTEMPTS + 1

/**
 * The failed-attempt count at which a concept's Pre-Flight history is
 * surfaced as a quality signal (SPEC story 35): "repeated failures on the
 * same concept". `pre_flight_attempts` has no request/session key, so
 * repetition is measured at attempt granularity — two or more failed runs
 * on the same concept, whether they came from one request's retry loop or
 * across several, mark the concept as hard to generate for.
 */
export const PRE_FLIGHT_REPEATED_FAILURE_THRESHOLD = 2

/**
 * The recency window of the Pre-Flight attempt aggregate (SPEC story 35,
 * issue #103): only runs within the last N days count toward a concept's
 * aggregate. A lifetime aggregate lets two old failures followed by forty
 * successes still render "generation has been unreliable here"; the window
 * keeps the signal about the concept's current generation health. Chosen
 * to match a learner's weekly usage rhythm — the threshold semantics
 * (PRE_FLIGHT_REPEATED_FAILURE_THRESHOLD) are unaffected.
 */
export const PRE_FLIGHT_RECENCY_WINDOW_DAYS = 7

/**
 * One concept's Pre-Flight attempt aggregate (ADR-0010), the raw material
 * of the story-35 quality signal: how many generations have been attempted
 * for the concept and how many of those runs failed. A concept can carry
 * one of these while signalling nothing — it attaches below the threshold
 * (PRE_FLIGHT_REPEATED_FAILURE_THRESHOLD) — hence the aggregate name, not
 * a signal.
 */
export type PreFlightAttemptAggregate = {
  conceptId: string
  totalAttempts: number
  failedAttempts: number
}

/**
 * Outcome of one generation + Pre-Flight cycle (issue #8, retried per issue
 * #9), discriminated by how the exercise was produced:
 *
 * - `generated`: a fresh generation that passed Pre-Flight and was
 *   persisted as verified — on attempt 1-3, or on the circuit-breaker's
 *   terminal simplified-constraints regeneration (`simplified: true`,
 *   attempt 4, SPEC story 34).
 * - `verified-fallback`: no new generation. All 3 retry attempts failed and
 *   a previously verified exercise on the same concept exists, so its
 *   stored row — including `test_source` and `reference_solution` (ADR-0019)
 *   — is served as-is; nothing was regenerated and no new Pre-Flight run
 *   happened (the row was verified when it entered the bank).
 *
 * `targetConcepts` are the slugs actually joined to persisted concepts.
 * For `generated` outcomes, `prerequisites` surfaces the model-declared
 * prerequisite slugs at the feature boundary so they are not silently
 * dropped (issue #91); for `verified-fallback` they are absent because
 * `exercises` does not persist them.
 */
export type GenerateExerciseOutput =
  | {
      kind: 'generated'
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
      simplified: boolean
      /**
       * The declared intentional defect of an adversarial (debug-mode)
       * generation (SPEC story 52, PRD §20, issue #11): kind, description,
       * location, and the expected behavior of the fixed code. Present
       * exactly when the generation targeted an adversarial exercise;
       * absent otherwise.
       */
      defect?: ExerciseDefect
    }
  | {
      kind: 'verified-fallback'
      exercise: Exercise
      conceptSlug: string
      targetConcepts: string[]
      constraints: string[]
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
