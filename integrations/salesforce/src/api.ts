import type { SalesforceLeadAddRequest, SalesforceLeadAddResponse } from './model'

export type SalesforceApiConfig = {
  clientId: string
  clientSecret: string
  url: string
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()

export async function addLead(
  config: SalesforceApiConfig,
  request: SalesforceLeadAddRequest
): Promise<SalesforceLeadAddResponse> {
  const accessToken = await getAccessToken(config)

  const response = await fetch(`${config.url}/services/data/v62.0/sobjects/Lead`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (response.status === 401) tokenCache.delete(config.clientId)

  const jsonResponse = (await response.json()) as SalesforceLeadAddResponse
  if (!response.ok || !jsonResponse.success) {
    throw new Error(`Error adding lead to salesforce: ${JSON.stringify(jsonResponse.errors)}`)
  }
  return jsonResponse
}

async function getAccessToken(config: SalesforceApiConfig): Promise<string> {
  const cached = tokenCache.get(config.clientId)
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken

  const response = await fetch(`${config.url}/services/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })

  if (!response.ok) throw new Error('Error getting access token: ' + response.statusText)

  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('Error getting access token: ' + JSON.stringify(data))

  const ttlMs = ((data.expires_in ?? 900) - 30) * 1000
  tokenCache.set(config.clientId, { accessToken: data.access_token, expiresAt: Date.now() + ttlMs })
  return data.access_token
}
