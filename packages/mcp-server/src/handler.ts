import { createMcpServer, type EndpointGroups } from '@terros-inc/mcp-core'
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  verifyBearerToken,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'
import type { TokenExchanger } from './exchange.ts'
import type { ServerConfig } from './config.ts'
import { createRequestApiClient } from './client.ts'

export type RemoteMcpHandlerOptions = {
  config: ServerConfig
  /** Tool endpoints, loaded once per process and shared by every request's server. */
  endpoints: () => Promise<EndpointGroups>
  verifier: OAuthTokenVerifier
  /** Turns the caller's verified MCP token into a Terros API token for the same user. */
  exchangeToken: TokenExchanger
  version: string
  fetch?: typeof fetch
  onerror?: (error: Error) => void
}

export type RemoteMcpHandler = (request: Request) => Promise<Response>

/**
 * Scopes MCP clients request at Auth0: `offline_access` so they get a refresh token, `openid` for the login itself.
 * Advertised in the protected resource metadata and in the 401 challenge; not required of tokens.
 */
export const SCOPES = ['openid', 'offline_access']

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '600',
}

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
    { status: 405, headers: { Allow: allow } }
  )
}

function forbidden(message: string): Response {
  return Response.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, { status: 403 })
}

/**
 * Accept no Origin (non-browser clients), or exactly `https://<allowed hostname>`, as the gateway's WAF rule does.
 * Plain http and other ports are never allowed.
 */
function originValidationResponse(origin: string | null, allowedHostnames: string[]): Response | undefined {
  if (!origin || allowedHostnames.some((hostname) => origin.toLowerCase() === `https://${hostname}`)) return undefined
  return forbidden('Invalid Origin')
}

/**
 * Stateless Streamable HTTP MCP server at the root of its own origin (`config.resource`, set per stage). Every POST is served
 * by a fresh McpServer whose API client acts for that request's verified caller; nothing about a caller outlives its
 * request.
 */
export function createRemoteMcpHandler(options: RemoteMcpHandlerOptions): RemoteMcpHandler {
  const { config } = options
  const hostname = new URL(config.resource).hostname
  // The RFC 9728 document of a root resource lives at the bare /.well-known/oauth-protected-resource.
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(config.resource))
  const resourceMetadataPath = new URL(resourceMetadataUrl).pathname
  const resourceMetadata = {
    // Exactly the Auth0 API identifier (no trailing slash): clients send it back as the `resource` parameter.
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Terros',
  }
  let endpoints: Promise<EndpointGroups> | undefined

  const mcp = createMcpHandler(
    async ({ authInfo }) => {
      if (!authInfo) throw new Error('MCP request reached the server without verified credentials')
      endpoints ??= options.endpoints()
      const subjectToken = authInfo.token
      const client = createRequestApiClient({
        baseUrl: config.apiBaseUrl,
        // The MCP-audience token goes to Auth0 only; the Terros API gets a token issued for its own audience.
        accessToken: () => options.exchangeToken(subjectToken),
        version: options.version,
        fetch: options.fetch,
      })
      return createMcpServer({ endpoints: await endpoints, client, version: options.version })
    },
    { legacy: 'stateless', onerror: options.onerror }
  )

  return async (request) => {
    // Defense in depth: the gateway already rejects other hosts and origins (see infra/stack.ts).
    const origin = request.headers.get('origin')
    const rejected =
      hostHeaderValidationResponse(request, [hostname]) ?? originValidationResponse(origin, config.allowedOrigins)
    if (rejected) return rejected

    // Only an allowlisted browser origin gets this far, so it may read the response.
    if (!origin) return route(request)
    const response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request)
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', origin)
    headers.append('Vary', 'Origin')
    for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }

  async function route(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/health') {
      return request.method === 'GET'
        ? Response.json({ status: 'ok', version: options.version })
        : methodNotAllowed('GET')
    }
    if (pathname === resourceMetadataPath) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD')
      const response = Response.json(resourceMetadata, { headers: { 'Access-Control-Allow-Origin': '*' } })
      return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response
    }
    if (pathname !== '/') return Response.json({ error: 'Not found' }, { status: 404 })

    // Stateless: there is no session to stream (GET) or terminate (DELETE).
    if (request.method !== 'POST') return methodNotAllowed('POST')

    let authInfo
    try {
      authInfo = await verifyBearerToken(request.headers.get('authorization'), {
        verifier: options.verifier,
        resourceMetadataUrl,
      })
    } catch (error) {
      return bearerAuthChallengeResponse(error, { resourceMetadataUrl, requiredScopes: SCOPES })
    }
    return mcp.fetch(request, { authInfo })
  }
}
