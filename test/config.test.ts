import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getConfig } from '../worker/lib/config'

describe('deploy-time config', () => {
  it('reads the values committed in wrangler.jsonc', () => {
    const config = getConfig(env)
    expect(config).toMatchObject({
      registrationOpen: true,
      passwordIterations: 20_000,
      defaultMailboxQuota: 10,
      maxTotalMailboxes: 100,
      maxDailyMailboxCreations: 30,
      retentionDays: 30,
      ingest: { perMailboxPerHour: 10, perUserPerHour: 100, messagesPerDay: 5000, bytesPerDay: 12 * 1024 * 1024, parseWindowBytes: 256 * 1024 },
    })
    expect(config.sessionTtlMs).toBe(30 * 24 * 3600 * 1000)
  })

  it('falls back to safe defaults for invalid or out-of-range values', () => {
    const config = getConfig({
      ...env,
      PASSWORD_PBKDF2_ITERATIONS: '999999999', // above the Workers maximum
      INGEST_MAX_PER_MAILBOX_PER_HOUR: 'ten',
      INGEST_PARSE_WINDOW_KB: '1', // below the minimum
      MESSAGE_RETENTION_DAYS: '-5',
      REGISTRATION_OPEN: 'yes please',
      DEFAULT_MAILBOX_QUOTA: '2.5',
    } as Env)
    expect(config).toMatchObject({
      passwordIterations: 20_000,
      registrationOpen: true,
      defaultMailboxQuota: 10,
      retentionDays: 30,
      ingest: { perMailboxPerHour: 10, parseWindowBytes: 256 * 1024 },
    })
  })

  it('accepts valid overrides', () => {
    const config = getConfig({ ...env, MESSAGE_RETENTION_DAYS: '0', REGISTRATION_OPEN: 'false', INGEST_MAX_MB_PER_DAY: '40' } as Env)
    expect(config).toMatchObject({ retentionDays: 0, registrationOpen: false, ingest: { bytesPerDay: 40 * 1024 * 1024 } })
  })
})
