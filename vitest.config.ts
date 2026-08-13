import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['./vitest.setup.ts'],
    // Several DB-backed suites share one real Postgres instance and the
    // `learners` table's single-row v1 invariant (ADR-0014):
    // `mastery.server.test.ts` briefly inserts a second learner row for its
    // own fixture (removed in its `afterAll`), and any other suite's
    // `getCurrentLearnerId()` call that lands inside that window hard-throws
    // on "more than one learner row" (issue #12 sweep: this started failing
    // under file-level parallelism once `exercise.server.test.ts` grew a
    // couple more DB round trips). Serializing file execution removes the
    // race by construction rather than narrowing an inherently timing-
    // dependent window.
    fileParallelism: false,
  },
})
