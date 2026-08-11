import {
  HINT_LADDER_MANUAL_MAX_LEVEL,
  HINT_LADDER_MAX_LEVEL,
} from '#/lib/hint-levels'

import { ExerciseError } from './exercise.schema'

/** The highest level reachable through the normal next-hint request. */
export const MAX_MANUAL_HINT_LEVEL = HINT_LADDER_MANUAL_MAX_LEVEL

/** The full-solution level, served only through the distinct action. */
export const FULL_SOLUTION_LEVEL = HINT_LADDER_MAX_LEVEL

/**
 * Resolves the target hint level for a learner action against the levels
 * already served in this attempt. Normal progression serves one level at a
 * time up to Level 4; Level 5 (full solution) is reachable only through the
 * distinct full-solution action, and only after Level 4 was served. Level
 * 5 is never served twice.
 */
export function resolveTargetLevel(
  servedLevels: readonly number[],
  action: 'next' | 'full_solution',
): number {
  const lastLevel = servedLevels.length === 0 ? -1 : Math.max(...servedLevels)

  if (action === 'full_solution') {
    if (lastLevel !== MAX_MANUAL_HINT_LEVEL) {
      throw new ExerciseError('HINT_ESCALATION_INVALID')
    }
    return FULL_SOLUTION_LEVEL
  }

  const nextLevel = lastLevel + 1
  if (nextLevel > MAX_MANUAL_HINT_LEVEL) {
    throw new ExerciseError('HINT_ESCALATION_INVALID')
  }
  return nextLevel
}
