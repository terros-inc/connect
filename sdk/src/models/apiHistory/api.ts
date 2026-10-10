import type { ApiSuccess } from '@terros-inc/connect-common'
import type { UserId } from '../user'
import type { CompanyId } from '../company'
import type { ApiHistoryItem } from './model'

export type ApiHistoryStartInput = {
  companyId?: CompanyId
  apiKeyOwnerId?: UserId
  apiKeyCreatedAt?: number
  status?: number
  endpoint?: string
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
