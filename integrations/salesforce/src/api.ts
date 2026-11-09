import { IntegrationError } from '@terros-inc/sdk'
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

  if (response.status === 401) {
    console.log('Salesforce rejected the cached access token, clearing cache')
    tokenCache.delete(config.clientId)
  }

  const jsonResponse = (await response.json()) as SalesforceLeadAddResponse
  if (!response.ok || !jsonResponse.success) {
    console.error(`Salesforce lead creation failed: ${response.status} ${response.statusText}`)
    throw new Error(`Error adding lead to salesforce: ${JSON.stringify(jsonResponse)}`)
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

  if (!response.ok) throw await accessTokenError(response)

  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('Error getting access token: ' + JSON.stringify(data))

  const ttlMs = ((data.expires_in ?? 900) - 30) * 1000
  tokenCache.set(config.clientId, { accessToken: data.access_token, expiresAt: Date.now() + ttlMs })
  return data.access_token
}

// Salesforce names why it refused a token in its OAuth error body. These two codes say the request itself is malformed,
// and Terros builds it the same way for every install, so they point at Terros; any other refusal is about this
// install's client credentials, url or connected app (run-as user, client credentials flow), which only the customer can
// fix. A timeout, a rate limit or a 5xx may pass on its own, so it is not the customer's either.
const MALFORMED_REQUEST_ERRORS = new Set(['invalid_request', 'unsupported_grant_type'])

async function accessTokenError(response: Response): Promise<Error> {
  const { error, description } = await readOAuthError(response)
  const reason = [error, description].filter(Boolean).join(': ')
  const message =
    `Error getting access token: ${response.status} ${response.statusText}`.trim() + (reason ? ` (${reason})` : '')

  if (!isRejectedRequest(response.status)) return new Error(`${message}. Salesforce did not issue a token; retry later`)
  if (error && MALFORMED_REQUEST_ERRORS.has(error)) {
    return new Error(`${message}. Salesforce rejected the token request Terros sent, likely a Terros-side problem`)
  }
  return new IntegrationError(
    `${message}. Salesforce rejected this install's credentials or config: the customer must check the clientId, ` +
      'clientSecret and url secrets, and that their connected app enables the client credentials flow with a run-as user'
  )
}

// Only Salesforce's own error code and description are kept: never the raw body, which on a wrong url can be any page.
async function readOAuthError(response: Response): Promise<{ error?: string; description?: string }> {
  try {
    const body: unknown = JSON.parse(await response.text())
    if (typeof body !== 'object' || body === null) return {}
    const { error, error_description } = body as Record<string, unknown>
    return { error: shortString(error), description: shortString(error_description) }
  } catch {
    return {}
  }
}

function shortString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, 200) : undefined
}

function isRejectedRequest(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}
