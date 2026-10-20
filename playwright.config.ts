import { defineConfig, devices } from '@playwright/test'

const PORT = 5188

/**
 * Browser tests against the real dev server (Vite + workerd), on throwaway state in .wrangler/e2e
 * that is rebuilt on every run (see vite.config.ts). Browsers: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'rm -rf .wrangler/e2e && npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && ' +
      `POSTLUMA_E2E=1 npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
