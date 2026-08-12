import type { EvaluationRubric } from '#/lib/ai/schemas'

/** Shared Stage 2 rubric criteria for the hardcoded is-even exercises (issue #6). */
export const REQUIRED_CRITERION =
  'Uses the remainder operator (%) to determine parity'
export const PROHIBITED_CRITERION =
  'Returns a hardcoded lookup table instead of computing parity'
export const ADVISORY_CRITERION = 'Keeps the function body minimal and readable'

/** The rubric the seed persists on every hardcoded exercise, mirrored by tests. */
export const STAGE2_RUBRIC: EvaluationRubric = {
  required: [REQUIRED_CRITERION],
  prohibited: [PROHIBITED_CRITERION],
  advisory: [ADVISORY_CRITERION],
}
