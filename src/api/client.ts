import { ERROR_CODES, type ErrorCode } from '../../shared/api'

export type ClientErrorCode = ErrorCode | 'network'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
  ) {
    super(code)
  }
}

let onUnauthorized: (() => void) | undefined

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

/** Calls whose 401 is an expected answer (bad credentials, not signed in) rather than a lost session. */
function isSessionProbe(method: string, path: string): boolean {
  return path === '/api/auth/login' || path === '/api/auth/register' || (method === 'GET' && path === '/api/auth/me')
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError(0, 'network')
  }
  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && !isSessionProbe(method, path)) onUnauthorized?.()
    const code = (data as { error?: unknown } | null)?.error
    throw new ApiRequestError(
      res.status,
      (ERROR_CODES as readonly unknown[]).includes(code) ? (code as ErrorCode) : 'internal_error',
    )
  }
  return data as T
}

/** A binary download (e.g. an original message); errors follow the same rules as JSON calls. */
async function requestBinary(path: string): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin' })
  } catch {
    throw new ApiRequestError(0, 'network')
  }
  if (res.ok) return res.arrayBuffer()
  if (res.status === 401) onUnauthorized?.()
  const code = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error
  throw new ApiRequestError(res.status, (ERROR_CODES as readonly unknown[]).includes(code) ? (code as ErrorCode) : 'internal_error')
}

export const http = {
  binary: requestBinary,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export function errorCodeOf(err: unknown): ClientErrorCode {
  return err instanceof ApiRequestError ? err.code : 'internal_error'
}
