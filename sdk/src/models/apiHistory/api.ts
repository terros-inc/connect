import type { ApiSuccess } from '@terros-inc/connect-common'
import type { UserId } from '../user'
import type { CompanyId } from '../company'
import type { ApiHistoryItem } from './model'

export type ApiHistoryStartInput = {
  companyId: CompanyId
  /** only requests with stored typed error responses */
  errorsOnly?: boolean
  /** API path, for example `/account/add` */
  endpoint?: string
  /** user or API-key owner */
  userId?: UserId
  /** ISO 8601 timestamp; the query covers at most the last seven days */
  since?: string
  limit?: number
}

export type ApiHistoryStartSuccess = ApiSuccess<{ queryId: string; effectiveSince: string; sinceClipped: boolean }>
export type ApiHistoryStatusInput = { queryId: string }
export type ApiHistoryStatusSuccess = ApiSuccess<{
  state: 'running' | 'succeeded' | 'failed'
  error?: string
  requests?: ApiHistoryItem[]
  effectiveSince?: string
  sinceClipped?: boolean
}>
