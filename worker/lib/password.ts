/**
 * PBKDF2-SHA256 password hashing via WebCrypto.
 * Stored format: "pbkdf2-sha256$<iterations>$<salt_b64>$<hash_b64>", so the cost can change later
 * without invalidating existing hashes.
 */
import { fromBase64, randomBytes, timingSafeEqual, toBase64 } from './crypto'

const ALGORITHM = 'pbkdf2-sha256'
/**
 * Cost for new hashes, sized for the Workers Free plan (10 ms CPU per request): measured at
 * ~2.3 ms per hash on a desktop Ryzen 5 5600 (100k took 11.4 ms), leaving headroom for password
 * changes, which hash twice. On the Paid plan raise this toward 100_000, the runtime's maximum;
 * existing hashes keep verifying because each stores its own iteration count.
 */
export const PBKDF2_ITERATIONS = 20_000
/** Highest count we accept when verifying (the Workers runtime limit). */
const MAX_ITERATIONS = 100_000
/** Hashes weaker than this are treated as invalid. */
const MIN_ITERATIONS = 10_000
const SALT_BYTES = 16
const KEY_BITS = 256

const encoder = new TextEncoder()

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `${ALGORITHM}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsRaw, saltB64, hashB64] = stored.split('$')
  if (algorithm !== ALGORITHM || !iterationsRaw || !saltB64 || !hashB64) return false
  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return false
  let salt: Uint8Array<ArrayBuffer>
  let expected: Uint8Array<ArrayBuffer>
  try {
    salt = fromBase64(saltB64)
    expected = fromBase64(hashB64)
  } catch {
    return false
  }
  return timingSafeEqual(await derive(password, salt, iterations), expected)
}

/** Same cost as a real check; used for unknown usernames so timing does not reveal which exist. */
export async function burnPasswordCheck(password: string): Promise<void> {
  await derive(password, new Uint8Array(SALT_BYTES), PBKDF2_ITERATIONS)
}
