/**
 * A verification link from a message is attacker-controlled: only plain https URLs without
 * credentials are ever turned into a clickable link (the Worker applies the same rule at delivery).
 */
export function safeLink(raw: string | null | undefined): URL | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}
