import { z } from 'zod'

/**
 * One normalized test entry in a Sandbox Result (CONTEXT.md — Sandbox Result).
 */
export const SandboxTestSchema = z.object({
  name: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'errored']),
  message: z.string().optional(),
  output: z.string().optional(),
})

export type SandboxTest = z.infer<typeof SandboxTestSchema>

/**
 * The normalized, language-independent shape a sandbox run produces.
 */
export const SandboxResultSchema = z.object({
  passed: z.boolean(),
  tests: z.array(SandboxTestSchema),
  message: z.string().optional(),
})

export type SandboxResult = z.infer<typeof SandboxResultSchema>

/** One exercise a learner can attempt, as exposed to routes and browser UI. */
export const ExerciseSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  language: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  starterCode: z.string(),
})

export type Exercise = z.infer<typeof ExerciseSchema>

/** Input accepted when a learner submits code for evaluation. */
export const SubmitExerciseInputSchema = z.object({
  exerciseId: z.string().min(1),
  code: z.string().trim().min(1, 'Enter some code to submit.').max(100_000),
})

export type SubmitExerciseInput = z.infer<typeof SubmitExerciseInputSchema>

/** Stable public exercise error codes. */
export type ExerciseErrorCode = 'EXERCISE_NOT_FOUND'

/** Safe error surfaced by exercise server boundaries. */
export class ExerciseError extends Error {
  readonly code: ExerciseErrorCode

  /** Creates a safe exercise feature error. */
  constructor(code: ExerciseErrorCode) {
    super('Exercise not found.')
    this.name = 'ExerciseError'
    this.code = code
  }
}
