import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['./vitest.setup.ts'],
    // The DB-backed suites share one Postgres instance and fixture data
    // (e.g. the mastery suite's own learner row, transient between
    // beforeAll/afterAll). File-parallel execution lets one suite observe
    // another's transient fixture rows — getCurrentLearnerId hard-throws on
    // two learner rows (ADR-0014), so parallel runs fail nondeterministically.
    fileParallelism: false,
  },
})
