import type { ApiSuccess } from '@terros-inc/connect-common'
import type { UserId } from '../user'
import type { CompanyId } from '../company'
import type { ApiHistoryItem } from './model'

export type ApiHistoryListInput = {
  companyId: CompanyId
  apiKeyOwnerId?: UserId
  apiKeyCreatedAt?: number
  status?: number
  endpoint?: string
  limit?: number
}

export type ApiHistoryListSuccess = ApiSuccess<{ requests: ApiHistoryItem[] }>
