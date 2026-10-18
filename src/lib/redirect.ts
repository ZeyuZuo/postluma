/** Only same-site paths are accepted as post-login redirects (blocks "//evil.example" and absolute URLs). */
export function safeRedirect(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback
  }
  return value
}
