import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          ADMIN_INITIAL_PASSWORD: 'test-admin-password',
          // Override any local .dev.vars so tests never call the real Turnstile API.
          TURNSTILE_SECRET_KEY: '',
          TURNSTILE_DISABLED: 'true',
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
})
