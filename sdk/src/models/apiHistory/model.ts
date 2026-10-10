import type { UserId } from '../user'
import type { CompanyId } from '../company'

export type ApiHistoryItem = {
  requestId: string
  companyId: CompanyId
  /** the user who made the request, or the owner of the API key that made it */
  userId?: UserId
  endpoint: string
  /** HTTP status stored with the completed request; typed API errors are stored as 200 */
  status: number
  latency?: number
  errorType?: string
  error?: string
  timestamp: number
  /** redacted and truncated */
  requestBody?: unknown
}
