import type { UserId } from '../user'
import type { CompanyId } from '../company'

export type ApiHistoryItem = {
  requestId: string
  companyId: CompanyId
  apiKeyOwnerId?: UserId
  apiKeyCreatedAt?: number
  endpoint: string
  status: number
  latency?: number
  error?: string
  timestamp: number
  requestBody: unknown
}
