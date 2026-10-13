export type ServerConfig = {
  /**
   * Public URL of the MCP server, an origin without a path or trailing slash, e.g. https://mcp.terros.com (prod) or
   * https://mcp.staging.terros.com (staging), set per stage by the stack. It is the
   * OAuth resource and the Auth0 audience of the tokens clients present, and its hostname is the only accepted Host.
   */
  resource: string
  /** Terros API that tool calls are forwarded to, with an API-audience token obtained per request by token exchange. */
  apiBaseUrl: string
  /** Auth0 issuer (tenant or custom domain) that signs the access tokens, with a trailing slash. */
  issuer: string
  /** Auth0 API identifier of the Terros API; exchanged tokens are issued for it. */
  apiAudience: string
  /** Auth0 application that performs the token exchange. Its client secret is read from Secrets Manager. */
  tokenExchangeClientId: string
  /** Secrets Manager secret (name or ARN) holding that application's client secret. */
  tokenExchangeSecretId: string
  /** Browser origin hostnames allowed to call the server, over https only. Requests without an Origin header are not affected. */
  allowedOrigins: string[]
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

/** Parse the server's public URL: https, no path, query or fragment. Returns it without a trailing slash. */
export function parseResource(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new Error(
      `MCP_RESOURCE_URL must be an https origin without a path, e.g. https://mcp.terros.com (got ${value})`
    )
  }
  return url.origin
}

/** Read the server configuration from the Lambda environment. */
export function readConfig(env: Env = process.env): ServerConfig {
  // Every tool call uses the caller's own identity; a deployment-wide key would act for every user.
  if (env.TERROS_API_KEY) throw new Error('TERROS_API_KEY must not be set for the hosted MCP server')

  const resource = parseResource(required(env, 'MCP_RESOURCE_URL'))
  const issuer = required(env, 'AUTH0_ISSUER')
  return {
    resource,
    apiBaseUrl: required(env, 'TERROS_API_ENDPOINT').replace(/\/+$/, ''),
    issuer: issuer.endsWith('/') ? issuer : `${issuer}/`,
    apiAudience: required(env, 'TERROS_API_AUDIENCE'),
    tokenExchangeClientId: required(env, 'AUTH0_TOKEN_EXCHANGE_CLIENT_ID'),
    tokenExchangeSecretId: required(env, 'AUTH0_TOKEN_EXCHANGE_SECRET_ID'),
    allowedOrigins: [
      new URL(resource).hostname,
      ...(env.MCP_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
  }
}
