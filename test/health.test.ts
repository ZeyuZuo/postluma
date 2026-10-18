import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const res = await SELF.fetch('https://postluma.test/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', db: true })
  })

  it('has the initial schema applied', async () => {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'default_mailbox_quota'",
    ).first<{ value: string }>()
    expect(row?.value).toBe('10')
  })
})
