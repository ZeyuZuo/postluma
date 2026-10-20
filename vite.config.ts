import { fileURLToPath, URL } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

/**
 * VITE_* values are baked into the public JS bundle. Turnstile site keys are 24 characters and
 * secret keys 35, so anything this long is almost certainly the secret pasted into the wrong
 * variable — fail the build instead of publishing it.
 */
const MAX_SITE_KEY_LENGTH = 30

function assertTurnstileSiteKey(mode: string): void {
  const siteKey = loadEnv(mode, process.cwd(), 'VITE_').VITE_TURNSTILE_SITE_KEY ?? ''
  if (siteKey.length > MAX_SITE_KEY_LENGTH) {
    throw new Error(
      `VITE_TURNSTILE_SITE_KEY is ${siteKey.length} characters long, which looks like a Turnstile SECRET key. ` +
        'Use the 24-character Site Key here; the secret belongs in the Worker secret TURNSTILE_SECRET_KEY. ' +
        'If the secret was ever deployed, rotate it in the Turnstile dashboard.',
    )
  }
}

/**
 * `npm run test:e2e` (POSTLUMA_E2E=1) runs the dev server against its own throwaway local state
 * (.wrangler/e2e, rebuilt per run) with Turnstile off, so browser tests never touch your dev data.
 */
const E2E = process.env.POSTLUMA_E2E === '1'
const E2E_STATE = '.wrangler/e2e'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  assertTurnstileSiteKey(mode)
  return {
    plugins: [
      vue(),
      cloudflare(
        E2E ? { persistState: { path: E2E_STATE }, config: { vars: { TURNSTILE_DISABLED: 'true' } } } : {},
      ),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
