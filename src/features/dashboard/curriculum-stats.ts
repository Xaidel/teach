import type { CurriculumStep } from '#/features/curriculum/curriculum.schema'

/** Aggregate mastery counts across a Class A sequence, for the Dashboard's stat tiles. */
export type CurriculumStats = {
  /** Steps whose mastery has reached Practiced or better (SPEC story 1's "complete" status). */
  complete: number
  /** Total steps in the sequence. */
  total: number
  /** Steps mastered to Retained — the Spaced Refresher's permanent state. */
  retained: number
  /** `complete / total` as a whole-number percentage, 0 when there are no steps. */
  pct: number
}

/**
 * Derives the Dashboard's overall-progress and concepts-mastered figures from
 * a Class A curriculum sequence (issue #14's `getCurriculumFn`) — no
 * separate persistence, since every figure is a re-derivation of mastery
 * state the curriculum step already carries.
 */
export function computeCurriculumStats(
  steps: readonly CurriculumStep[],
): CurriculumStats {
  const total = steps.length
  const complete = steps.filter((step) => step.status === 'complete').length
  const retained = steps.filter((step) => step.mastery === 'retained').length
  const pct = total === 0 ? 0 : Math.round((complete / total) * 100)

  return { complete, total, retained, pct }
}
