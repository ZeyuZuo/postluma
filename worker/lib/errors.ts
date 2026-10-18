import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { ErrorCode } from '../../shared/api'

/** Thrown anywhere in a request; `app.onError` turns it into `{ error: code }` with `status`. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
  ) {
    super(code)
  }
}
