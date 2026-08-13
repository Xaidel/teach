/**
 * The five Learner Model mastery states and their total order (ADR-0010,
 * SPEC story 41).
 *
 * Single source of truth for the vocabulary and ordering, because three
 * kinds of consumers need them: the `learners` feature's mastery writes and
 * rank comparisons (`MASTERY_STATE_ORDER`), the `tactical-sprint` and
 * `explanation-assessment` features' display-only schema mirrors, and the
 * DB enum (`src/db/schema.ts`) which shares the same values — one
 * coordinated edit if a state ever changes, never several hardcoded lists
 * drifting apart.
 *
 * Lives in `src/lib` per the dependency rules' shared-constant precedent
 * (`explanation-depth.ts`, `hint-levels.ts`): the states have no single
 * feature owner, and browser-reachable schema modules must not import the
 * `learners` feature's server module.
 */

/** The five mastery states in ascending order (ADR-0010). */
export const MASTERY_STATES = [
  'unknown',
  'introduced',
  'practiced',
  'demonstrated',
  'retained',
] as const

export type MasteryState = (typeof MASTERY_STATES)[number]

/** Maps a mastery state to its rank for ordering and rank comparison. */
export const MASTERY_STATE_ORDER: Record<MasteryState, number> = {
  unknown: 0,
  introduced: 1,
  practiced: 2,
  demonstrated: 3,
  retained: 4,
}
