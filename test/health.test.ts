import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { api, json } from './helpers'

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const res = await SELF.fetch('https://postluma.test/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', db: true })
  })

  it('has the initial schema applied', async () => {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ingest_counters'").first<{ n: number }>()
    expect(row?.n).toBe(1)
  })
})

describe('GET /api/settings/public', () => {
  it('reports the service mode', async () => {
    expect(await json(await api('/api/settings/public'))).toMatchObject({ mode: 'temporary' })
    expect(await json(await api('/api/settings/public', { env: { SERVICE_MODE: 'personal' } }))).toMatchObject({ mode: 'personal' })
  })

  // The sign-in pages read the Turnstile site key from here, so deployments made with the Deploy
  // to Cloudflare button (which cannot set build variables) need no rebuild.
  const turnstileOn = { TURNSTILE_DISABLED: 'false' }
  const testSiteKey = '1x00000000000000000000AA'

  it('publishes the Turnstile site key', async () => {
    const res = await api('/api/settings/public', { env: { ...turnstileOn, TURNSTILE_SITE_KEY: ` ${testSiteKey} ` } })
    expect(await json(res)).toMatchObject({ turnstileSiteKey: testSiteKey })
  })

  it('publishes no site key when Turnstile is off or the key is missing', async () => {
    const off = await api('/api/settings/public', { env: { TURNSTILE_SITE_KEY: testSiteKey } })
    expect(await json(off)).toMatchObject({ turnstileSiteKey: null })
    const missing = await api('/api/settings/public', { env: turnstileOn })
    expect(await json(missing)).toMatchObject({ turnstileSiteKey: null })
  })

  it('never publishes a value as long as a secret key', async () => {
    // Secret keys are 35 characters: this is the secret pasted into the site key's place.
    const res = await api('/api/settings/public', { env: { ...turnstileOn, TURNSTILE_SITE_KEY: '1x0000000000000000000000000000000AA' } })
    expect(await json(res)).toMatchObject({ turnstileSiteKey: null })
  })
})
