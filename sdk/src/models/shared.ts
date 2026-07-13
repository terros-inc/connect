import type { UserId } from './user'

/** A Connect API route string, e.g. "user/get" or "account/status/add". */
export type ApiRoute = string

export type ApiSuccess<T = unknown> = { type: 'success' } & T

export type ResponseError = {
  type: 'error'
  error: string
  message?: string
  retry?: boolean
}

export type ResponseOutput = ApiSuccess | ResponseError

export function isResponseError(response: unknown): response is ResponseError {
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { type?: unknown }).type === 'error' &&
    Boolean((response as { error?: unknown }).error)
  )
}

export type CustomFieldMap = Record<string, string | number | boolean | null>

export type AuditLog = {
  userId: UserId
  timestamp: number
  updateProcess?: string
}

export type AuditProps = {
  modifiedBy?: AuditLog[]
  /** @deprecated */
  createdAt?: number
  /** @deprecated */
  createdBy?: UserId
  updatedAt?: number
  /** @deprecated */
  updatedBy?: UserId
  lastUpdateProcess?: string
  version?: number
}
