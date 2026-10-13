/**
 * The `subject_token_type` of the Auth0 Custom Token Exchange profile (docs/RUNBOOK.md §1). It names "an access
 * token issued for the MCP server"; the profile's Action validates such a token and sets its user.
 */
export const MCP_SUBJECT_TOKEN_TYPE = 'https://terros.com/token-types/mcp-access-token'

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'

export type TokenExchangeOptions = {
  issuer: string
  /** Auth0 API identifier of the Terros API, the audience of the exchanged token. */
  audience: string
  clientId: string
  /** The exchange application's client secret, read once and kept in memory. */
  clientSecret: () => Promise<string>
  fetch?: typeof fetch
}

/** Exchange a caller's MCP-audience access token for a Terros API access token for the same user. */
export type TokenExchanger = (subjectToken: string) => Promise<string>

/**
 * RFC 8693 token exchange against Auth0 (Custom Token Exchange). The MCP-audience token is never sent to the Terros
 * API: it is only presented to Auth0, which issues a token for the Terros API audience for the same user.
 */
export function createAuth0TokenExchange(options: TokenExchangeOptions): TokenExchanger {
  const fetchImpl = options.fetch ?? fetch
  const tokenUrl = new URL('oauth/token', options.issuer).href
  return async (subjectToken) => {
    const body = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subjectToken,
      subject_token_type: MCP_SUBJECT_TOKEN_TYPE,
      audience: options.audience,
      client_id: options.clientId,
      client_secret: await options.clientSecret(),
    })
    let response: Response
    try {
      response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      })
    } catch (cause) {
      throw new Error('Could not reach the authorization server to authorize the Terros API call', { cause })
    }
    const output = (await response.json().catch(() => ({}))) as {
      access_token?: unknown
      error?: unknown
      error_description?: unknown
    }
    if (!response.ok || typeof output.access_token !== 'string') {
      // Auth0's error code and description name the failed check; they never contain the tokens.
      const reason = [output.error, output.error_description].filter((part) => typeof part === 'string').join(': ')
      throw new Error(`Terros API authorization failed (${reason || response.status})`)
    }
    return output.access_token
  }
}
