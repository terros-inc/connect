import * as process from 'node:process'
import { getAuthorizationHeader } from './auth.ts'
import { getAnalyticsHeaders } from './analytics.ts'

export async function queryTerrosAPI(path: string, input: object): Promise<object> {
  const endpoint = getApiEndpoint()
  const impersonation = getImpersonationHeaders()
  const analytics = getAnalyticsHeaders()
  const authorization = await getAuthorizationHeader()

  const res = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: {
      ...analytics,
      ...impersonation,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  return (await res.json()) as object
}

function getApiEndpoint(): string {
  const envEndpoint = process.env.TERROS_API_ENDPOINT
  if (envEndpoint) return envEndpoint

  return 'https://api.terros.com'
}

function getImpersonationHeaders(): Record<string, string> {
  const userId = process.env.TERROS_IMPERSONATE
  if (userId) return { impersonate_user_id: userId }

  return {}
}
