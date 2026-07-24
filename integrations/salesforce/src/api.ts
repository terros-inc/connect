import type { SalesforceLeadAddRequest, SalesforceLeadAddResponse } from './model'

export type SalesforceApiConfig = {
  clientId: string
  clientSecret: string
  url: string
}

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

  const jsonResponse = (await response.json()) as SalesforceLeadAddResponse
  if (!response.ok || !jsonResponse.success) {
    throw new Error(`Error adding lead to salesforce: ${JSON.stringify(jsonResponse.errors)}`)
  }
  return jsonResponse
}

async function getAccessToken(config: SalesforceApiConfig): Promise<string> {
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

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Error getting access token: ' + JSON.stringify(data))
  return data.access_token
}
