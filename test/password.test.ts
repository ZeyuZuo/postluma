import { describe, expect, it } from 'vitest'

import { PBKDF2_ITERATIONS, hashPassword, verifyPassword } from '../worker/lib/password'

describe('password hashing', () => {
  it('produces a self-describing salted hash', async () => {
    const a = await hashPassword('s3cret-pass')
    const b = await hashPassword('s3cret-pass')
    expect(a).toMatch(new RegExp(`^pbkdf2-sha256\\$${PBKDF2_ITERATIONS}\\$[A-Za-z0-9+/=]+\\$[A-Za-z0-9+/=]+$`))
    expect(a).not.toBe(b)
  })

  it('verifies only the original password', async () => {
    const stored = await hashPassword('s3cret-pass')
    expect(await verifyPassword('s3cret-pass', stored)).toBe(true)
    expect(await verifyPassword('s3cret-pasS', stored)).toBe(false)
  })

  it('rejects malformed or tampered hashes', async () => {
    const stored = await hashPassword('s3cret-pass')
    expect(await verifyPassword('s3cret-pass', 'plaintext')).toBe(false)
    expect(await verifyPassword('s3cret-pass', stored.replace('pbkdf2-sha256', 'md5'))).toBe(false)
    expect(await verifyPassword('s3cret-pass', stored.replace(`$${PBKDF2_ITERATIONS}$`, '$999999999$'))).toBe(false)
  })

  it('still verifies hashes made with a different (e.g. older, stronger) cost', async () => {
    const enc = new TextEncoder()
    const salt = new Uint8Array(16)
    const key = await crypto.subtle.importKey('raw', enc.encode('legacy-pass'), 'PBKDF2', false, ['deriveBits'])
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256))
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
    expect(await verifyPassword('legacy-pass', `pbkdf2-sha256$100000$${b64(salt)}$${b64(bits)}`)).toBe(true)
  })
})
