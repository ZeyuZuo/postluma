import { randomBytes } from './crypto'

// Easy to read aloud and retype: no i/l/o/0/1.
const LETTERS = 'abcdefghjkmnpqrstuvwxyz'
const CHARS = `${LETTERS}23456789`
export const RANDOM_LOCAL_PART_LENGTH = 10

/** Uniform pick via rejection sampling (no modulo bias). */
function pick(alphabet: string): string {
  const limit = 256 - (256 % alphabet.length)
  for (;;) {
    const byte = randomBytes(1)[0]!
    if (byte < limit) return alphabet[byte % alphabet.length]!
  }
}

/** e.g. "k7mq2hx9ta" — starts with a letter, ~49 bits of entropy. */
export function randomLocalPart(): string {
  let out = pick(LETTERS)
  while (out.length < RANDOM_LOCAL_PART_LENGTH) out += pick(CHARS)
  return out
}
