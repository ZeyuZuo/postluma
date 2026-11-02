import { defineConfig, devices } from '@playwright/test'

/**
 * One dev server per service mode, each on throwaway state rebuilt on every run (see vite.config.ts).
 * Keep in step with PROJECTS in e2e/helpers.ts.
 */
const SERVERS = {
  temporary: { port: 5188, state: '.wrangler/e2e' },
  personal: { port: 5189, state: '.wrangler/e2e-personal' },
} as const

/**
 * Browser tests against the real dev server (Vite + workerd). `*.personal.spec.ts` runs against the
 * personal-mode server, everything else against the temporary-mode one.
 * Browsers: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'temporary',
      testIgnore: '**/*.personal.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${SERVERS.temporary.port}` },
    },
    {
      name: 'personal',
      testMatch: '**/*.personal.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${SERVERS.personal.port}` },
    },
  ],
  webServer: Object.entries(SERVERS).map(([mode, { port, state }]) => ({
    command:
      `rm -rf ${state} && npx wrangler d1 migrations apply DB --local --persist-to ${state} && ` +
      `POSTLUMA_E2E=1 POSTLUMA_E2E_MODE=${mode} npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  })),
})
