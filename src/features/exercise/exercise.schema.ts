import { z } from 'zod'

import type { Hint } from '#/lib/ai/schemas'
import { SANDBOX_LANGUAGES } from '#/lib/sandbox/types'
import { SandboxResultSchema, type SandboxResult } from '#/lib/sandbox/types'

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
  language: z.enum(SANDBOX_LANGUAGES),
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

/**
 * Output of a submission: the deterministic Sandbox Result, plus a Socratic
 * hint when Stage 1 failed and the AI Teacher Engine produced one. The hint
 * is never the pass/fail authority — `result.passed` always is (issue #3).
 * `submissionId` anchors later manual hint requests against the attempt
 * (issue #4).
 */
export type SubmitExerciseOutput = {
  submissionId: string
  result: SandboxResult
  hint: Hint | null
}

/** The two learner actions that can advance a manual hint ladder (issue #4). */
export const HintRequestActionSchema = z.enum(['next', 'full_solution'])

export type HintRequestAction = z.infer<typeof HintRequestActionSchema>

/** Input for requesting another hint on a persisted exercise attempt. */
export const RequestHintInputSchema = z.object({
  submissionId: z.uuid(),
  action: HintRequestActionSchema,
})

export type RequestHintInput = z.infer<typeof RequestHintInputSchema>

/** Output after one additional hint level has been served. */
export type RequestHintOutput = {
  hint: Hint
}

/** Stable public exercise error codes. */
export type ExerciseErrorCode =
  | 'EXERCISE_NOT_FOUND'
  | 'EXERCISE_NOT_SUBMITTABLE'
  | 'EXERCISE_NOT_HINTABLE'
  | 'SANDBOX_RESULT_INVALID'
  | 'HINT_ESCALATION_INVALID'

const EXERCISE_ERROR_MESSAGES: Record<ExerciseErrorCode, string> = {
  EXERCISE_NOT_FOUND: 'Exercise not found.',
  EXERCISE_NOT_SUBMITTABLE:
    'This exercise has no test source and cannot be submitted.',
  EXERCISE_NOT_HINTABLE:
    'This exercise has no reference solution and cannot serve hints.',
  SANDBOX_RESULT_INVALID:
    'The sandbox produced an invalid result; the submission was not persisted.',
  HINT_ESCALATION_INVALID:
    'That hint level is not available for this exercise attempt.',
}

/** Safe error surfaced by exercise server boundaries. */
export class ExerciseError extends Error {
  readonly code: ExerciseErrorCode

  /** Creates a safe exercise feature error. */
  constructor(code: ExerciseErrorCode) {
    super(EXERCISE_ERROR_MESSAGES[code])
    this.name = 'ExerciseError'
    this.code = code
  }
}

/**
 * Validates sandbox output at the persistence boundary, mapping any schema
 * violation to the stable exercise error code. Only the parse is wrapped:
 * infrastructure failures from the runner propagate as `SandboxError`.
 */
export function parseSandboxResult(raw: unknown): SandboxResult {
  try {
    return SandboxResultSchema.parse(raw)
  } catch {
    throw new ExerciseError('SANDBOX_RESULT_INVALID')
  }
}
