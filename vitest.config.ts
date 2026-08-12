import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['./vitest.setup.ts'],
    // Test files share one Postgres and several assert global row counts
    // (e.g. the Concept Graph idempotency test); running files in parallel
    // lets one file's fixtures race another's assertions.
    fileParallelism: false,
  },
})
