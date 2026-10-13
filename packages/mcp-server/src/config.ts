export type ServerConfig = {
  /** Public URL of the MCP endpoint, e.g. https://mcp.terros.com/mcp. Its hostname is the only accepted Host. */
  resourceUrl: URL
  /** Terros API that tool calls are forwarded to with the caller's own access token. */
  apiBaseUrl: string
  /** Auth0 issuer (tenant or custom domain) that signs the access tokens, with a trailing slash. */
  issuer: string
  /** Auth0 API identifier the access tokens must be issued for. */
  audience: string
  /** Browser origins (hostnames) allowed to call the endpoint. Requests without an Origin header are not affected. */
  allowedOrigins: string[]
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

/** Read the server configuration from the Lambda environment. */
export function readConfig(env: Env = process.env): ServerConfig {
  // Every tool call uses the caller's token; a deployment-wide key would act for every user.
  if (env.TERROS_API_KEY) throw new Error('TERROS_API_KEY must not be set for the hosted MCP server')

  const resourceUrl = new URL(required(env, 'MCP_RESOURCE_URL'))
  const issuer = required(env, 'AUTH0_ISSUER')
  return {
    resourceUrl,
    apiBaseUrl: required(env, 'TERROS_API_ENDPOINT').replace(/\/+$/, ''),
    issuer: issuer.endsWith('/') ? issuer : `${issuer}/`,
    audience: required(env, 'AUTH0_AUDIENCE'),
    allowedOrigins: [
      resourceUrl.hostname,
      ...(env.MCP_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
  }
}
