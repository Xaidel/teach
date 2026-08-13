import { z } from 'zod'

import {
  EXPLANATION_DEPTH_MAX,
  EXPLANATION_DEPTH_MIN,
} from '#/lib/explanation-depth'

/**
 * A learner's adaptive explanation preferences (issue #12, PRD §12): the
 * depth (1: Intuitive through 5: Runtime/Compiler Internals) and optional
 * reference frame threaded into `explainConcept`/`generateHint` calls to
 * shape presentation only.
 */
export type ExplanationPreferences = {
  depth: number
  referenceFrame: string | null
}

/**
 * Input for changing a learner's explanation preferences. Both fields are
 * optional and independent — a learner may set/change depth, reference
 * frame, or both in one request (issue #12's two separate ACs); an omitted
 * field leaves that preference unchanged. Passing `referenceFrame: null`
 * clears a previously set reference frame.
 */
export const UpdateExplanationPreferencesInputSchema = z.object({
  depth: z
    .number()
    .int()
    .min(EXPLANATION_DEPTH_MIN)
    .max(EXPLANATION_DEPTH_MAX)
    .optional(),
  referenceFrame: z.string().trim().min(1).max(200).nullable().optional(),
})

export type UpdateExplanationPreferencesInput = z.infer<
  typeof UpdateExplanationPreferencesInputSchema
>
