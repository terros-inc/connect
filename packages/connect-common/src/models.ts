/** A Connect API route string, e.g. "user/get" or "account/status/add". */
export type ApiRoute = string

export type ResponseError = {
  type: 'error'
  error: string
  message?: string
  retry?: boolean
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
