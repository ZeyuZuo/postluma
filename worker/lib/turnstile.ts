import { ApiError } from './errors'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5000
/** Site keys are 24 characters and secret keys 35; same limit as vite.config.ts. */
const MAX_SITE_KEY_LENGTH = 30

/**
 * The public site key the sign-in pages render the widget with (`/api/settings/public`), or null when
 * Turnstile is off or no key is set. A value as long as a secret key is the secret pasted into the
 * wrong place: it is never published, and sign-in then fails closed.
 */
export function turnstileSiteKey(env: Env): string | null {
  if (env.TURNSTILE_DISABLED === 'true') return null
  const key = (env.TURNSTILE_SITE_KEY ?? '').trim()
  if (key === '') return null
  if (key.length > MAX_SITE_KEY_LENGTH) {
    console.error('TURNSTILE_SITE_KEY looks like a secret key; not publishing it (rotate the secret if it was ever deployed)')
    return null
  }
  return key
}

interface SiteverifyResult {
  success?: boolean
  hostname?: string
  action?: string
}

/**
 * Verifies a Turnstile token. Fails closed: a missing secret is a server misconfiguration unless
 * TURNSTILE_DISABLED is explicitly "true" (local dev and tests only).
 */
export async function requireTurnstile(
  env: Env,
  token: string | undefined,
  ip: string,
  expected: { hostname: string; action: string },
): Promise<void> {
  if (env.TURNSTILE_DISABLED === 'true') return
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error('TURNSTILE_SECRET_KEY is not set; refusing auth requests (set TURNSTILE_DISABLED=true only in dev)')
    throw new ApiError(500, 'internal_error')
  }
  if (!token) throw new ApiError(400, 'turnstile_failed')

  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET_KEY)
  form.append('response', token)
  if (ip !== 'unknown') form.append('remoteip', ip)

  let outcome: SiteverifyResult
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`)
    outcome = (await res.json()) as SiteverifyResult
  } catch (err) {
    console.error('Turnstile verification failed', err)
    throw new ApiError(400, 'turnstile_failed')
  }
  if (!outcome.success || outcome.hostname !== expected.hostname || outcome.action !== expected.action) {
    throw new ApiError(400, 'turnstile_failed')
  }
}
