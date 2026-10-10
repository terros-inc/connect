type ApiCaller = { call(path: string, input: object): Promise<unknown> }
type StartResponse = { type: 'success'; queryId: string; effectiveSince?: string; sinceClipped?: boolean }
type StatusResponse = {
  type: 'success'
  state: 'running' | 'succeeded' | 'failed'
  error?: string
  requests?: unknown[]
  effectiveSince?: string
  sinceClipped?: boolean
}

const POLL_INTERVAL_MS = 2_000
const TIMEOUT_MS = 120_000

export async function runApiHistoryQuery(client: ApiCaller, input: object): Promise<StatusResponse> {
  if (!('companyId' in input) || typeof input.companyId !== 'string' || input.companyId === '') {
    throw new Error('API history requires --companyId')
  }
  const started = assertStart(await client.call('apiHistory/start', input))
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = assertStatus(await client.call('apiHistory/status', { queryId: started.queryId }))
    if (status.state === 'failed') throw new Error(status.error ?? 'API history query failed')
    if (status.state === 'succeeded')
      return {
        ...status,
        effectiveSince: status.effectiveSince ?? started.effectiveSince,
        sinceClipped: status.sinceClipped ?? started.sinceClipped,
      }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(
    `API history query ${started.queryId} timed out after ${TIMEOUT_MS / 1000} seconds; resume it with apiHistory status --queryId ${started.queryId}`
  )
}

function assertStart(value: unknown): StartResponse {
  if (!value || typeof value !== 'object' || !('queryId' in value) || typeof value.queryId !== 'string') {
    throw new Error('API history query did not return a query ID')
  }
  return value as StartResponse
}

function assertStatus(value: unknown): StatusResponse {
  if (!value || typeof value !== 'object' || !('state' in value)) throw new Error('Invalid API history status response')
  return value as StatusResponse
}
