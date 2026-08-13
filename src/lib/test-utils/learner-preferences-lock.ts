import postgres from 'postgres'

import { env } from '#/lib/env.server'

/**
 * Fixed Postgres advisory-lock key for the (single, v1) learner's
 * explanation-preferences row: every DB-backed test suite that mutates
 * `learners.explanation_depth` / `reference_frame` holds this lock for the
 * whole set/run/restore window, so parallel test files never interleave
 * their preference mutations on the one learner row (ADR-0014, issue #115).
 * The lock is acquired on a dedicated single-connection client (session
 * locks bind to one connection; the shared `db` pool cannot hold one
 * reliably across statements).
 */
const LEARNER_PREFERENCES_LOCK_KEY = 420_001

export async function withLearnerPreferencesLock<T>(
  run: () => Promise<T>,
): Promise<T> {
  const sql = postgres(env.DATABASE_URL, { max: 1 })
  try {
    await sql`select pg_advisory_lock(${LEARNER_PREFERENCES_LOCK_KEY})`
    return await run()
  } finally {
    // Best-effort unlock: the connection dies with the client regardless.
    try {
      await sql`select pg_advisory_unlock(${LEARNER_PREFERENCES_LOCK_KEY})`
    } catch {
      // The lock releases when the connection closes below anyway.
    }
    await sql.end()
  }
}
