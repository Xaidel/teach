import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Files run in parallel workers, each owning namespaced fixture slugs
  // (e2e.*) cleaned up by slug in afterAll (issue #92). Tests within one
  // file stay serial: the specs share fixture rows via beforeAll/afterAll,
  // so `fullyParallel` would race a file's own workers on the same rows.
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run start',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HOST: '127.0.0.1',
      PORT: '3000',
      // e2e marker (issue #93): rationale at the choke point,
      // lib/ai/client.server.ts.
      E2E_FORCE_AI_FAILURE: 'true',
    },
  },
})
