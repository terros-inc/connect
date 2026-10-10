import type { ApiSuccess } from '@terros-inc/connect-common'
import type { CompanyId } from '../company'
import type { ApiHistoryItem } from './model'

export type ApiHistoryStartInput = {
  companyId: CompanyId
  /** HTTP status the caller received, for example 503 for a gateway timeout */
  status?: number
  /** only error responses and statuses of 400 or more */
  errorsOnly?: boolean
  /** API path, for example `/account/add` */
  endpoint?: string
  /** ISO 8601 timestamp; the query covers at most the last seven days */
  since?: string
  limit?: number
}

export type ApiHistoryStartSuccess = ApiSuccess<{ queryId: string }>
export type ApiHistoryStatusInput = { queryId: string }
export type ApiHistoryStatusSuccess = ApiSuccess<{
  state: 'running' | 'succeeded' | 'failed'
  error?: string
  requests?: ApiHistoryItem[]
}>
