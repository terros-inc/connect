import type { UserId } from './user'

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
