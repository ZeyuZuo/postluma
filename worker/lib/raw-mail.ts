/**
 * Original messages (.eml) in R2. D1 holds the parsed, size-capped copy that the UI lists and
 * searches; R2 holds the bytes as received, so the client can download attachments and resolve
 * inline images without the Worker ever decoding them (Free plan: 10 ms CPU per invocation).
 */

/** Prefixed by owner so a user's objects can be found from R2 alone if ever needed. */
export function rawKey(userId: string, messageId: string): string {
  return `u/${userId}/${messageId}.eml`
}

/** R2 deletes at most 1000 keys per call. */
const DELETE_CHUNK = 1000

/**
 * Removes originals whose D1 rows are already gone. A failure only leaves an orphaned object
 * (unreachable: every read goes through the D1 row), so it is logged rather than surfaced.
 */
export async function deleteRaw(bucket: R2Bucket | null, keys: readonly (string | null)[]): Promise<void> {
  const list = keys.filter((k): k is string => Boolean(k))
  if (!bucket || list.length === 0) return
  try {
    for (let i = 0; i < list.length; i += DELETE_CHUNK) await bucket.delete(list.slice(i, i + DELETE_CHUNK))
  } catch (err) {
    console.error('Failed to delete original messages from R2', { count: list.length, error: String(err) })
  }
}
