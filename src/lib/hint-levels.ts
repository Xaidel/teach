/**
 * Single source of truth for the Socratic hint ladder bounds (issue #56).
 *
 * The ladder is 0..HINT_LADDER_MAX_LEVEL: Levels 0-4 climb one at a time via
 * the normal next-hint request, and the full-solution level is reachable only
 * through the distinct action after Level 4 was served. These constants feed
 * the ladder module (`src/features/exercise/hint-ladder.ts`), the AI output
 * schema bound (`src/lib/ai/schemas.ts`), and the `submission_hints` CHECK
 * constraint (`src/db/schema.ts`) so a ladder-depth change is one edit, not
 * three coordinated ones.
 */

/** The highest level reachable through the normal next-hint request. */
export const HINT_LADDER_MANUAL_MAX_LEVEL = 4

/** The full-solution level, served only through the distinct action. */
export const HINT_LADDER_MAX_LEVEL = 5
