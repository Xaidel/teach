import { z } from 'zod'

/**
 * The shared Sandbox Result shape is defined once in the sandbox lib
 * (src/lib/sandbox/types.ts) and re-exported here for the feature surface
 * (issue #39).
 */
export {
  SandboxResultSchema,
  SandboxTestSchema,
  type SandboxResult,
  type SandboxTest,
  type SandboxTestStatus,
} from '#/lib/sandbox/types'

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
