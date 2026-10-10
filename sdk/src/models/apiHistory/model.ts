import type { UserId } from '../user'
import type { CompanyId } from '../company'

export type ApiHistoryItem = {
  requestId: string
  companyId: CompanyId
  /** the user who made the request, or the owner of the API key that made it */
  userId?: UserId
  endpoint: string
  /** HTTP status the caller received */
  status: number
  /** false when the request never completed, for example because it timed out */
  completed: boolean
  latency?: number
  errorType?: string
  error?: string
  timestamp: number
  /** redacted and truncated; absent for requests that never completed */
  requestBody?: unknown
}
