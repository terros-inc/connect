/** A Connect API route string, e.g. "user/get" or "account/status/add". */
export type ApiRoute = string

export type ResponseError = {
  type: 'error'
  error: string
  message?: string
  retry?: boolean
}

/** An API failure that preserves its machine-readable error code for CLI and MCP callers. */
export class TerrosApiError extends Error {
  readonly code: string
  readonly response: ResponseError

  constructor(response: ResponseError) {
    super(response.message ? `${response.error}: ${response.message}` : response.error)
    this.name = 'TerrosApiError'
    this.code = response.error
    this.response = response
  }
}

export function isResponseError(response: unknown): response is ResponseError {
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { type?: unknown }).type === 'error' &&
    Boolean((response as { error?: unknown }).error)
  )
}

export type ApiSuccess<T = unknown> = { type: 'success' } & T
