import { createMcpServer, type EndpointGroups } from '@terros-inc/mcp-core'
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  verifyBearerToken,
  type AuthMetadataOptions,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'
import type { ServerConfig } from './config.ts'
import { createRequestApiClient } from './client.ts'
import { auth0Metadata } from './auth.ts'

export type RemoteMcpHandlerOptions = {
  config: ServerConfig
  /** Tool endpoints, loaded once per process and shared by every request's server. */
  endpoints: () => Promise<EndpointGroups>
  verifier: OAuthTokenVerifier
  version: string
  fetch?: typeof fetch
  onerror?: (error: Error) => void
}

export type RemoteMcpHandler = (request: Request) => Promise<Response>

function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

/**
 * Stateless Streamable HTTP MCP endpoint. Every POST is served by a fresh McpServer whose API client
 * carries that request's verified Auth0 access token; nothing about a caller outlives its request.
 */
export function createRemoteMcpHandler(options: RemoteMcpHandlerOptions): RemoteMcpHandler {
  const { config } = options
  const metadata: AuthMetadataOptions = {
    oauthMetadata: auth0Metadata(config.issuer),
    resourceServerUrl: config.resourceUrl,
    resourceName: 'Terros',
  }
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl)
  let endpoints: Promise<EndpointGroups> | undefined

  const mcp = createMcpHandler(
    async ({ authInfo }) => {
      if (!authInfo) throw new Error('MCP request reached the server without verified credentials')
      endpoints ??= options.endpoints()
      const client = createRequestApiClient({
        baseUrl: config.apiBaseUrl,
        accessToken: authInfo.token,
        version: options.version,
        fetch: options.fetch,
      })
      return createMcpServer({ endpoints: await endpoints, client, version: options.version })
    },
    { legacy: 'stateless', onerror: options.onerror }
  )

  return async (request) => {
    // Defense in depth: the gateway already rejects other hosts and origins (see infra/stack.ts).
    const rejected =
      hostHeaderValidationResponse(request, [config.resourceUrl.hostname]) ??
      originValidationResponse(request, config.allowedOrigins)
    if (rejected) return rejected

    const { pathname } = new URL(request.url)
    if (pathname === '/health') {
      return request.method === 'GET' ? Response.json({ status: 'ok', version: options.version }) : methodNotAllowed()
    }
    const discovery = oauthMetadataResponse(request, metadata)
    if (discovery) return discovery
    if (pathname !== config.resourceUrl.pathname) return Response.json({ error: 'Not found' }, { status: 404 })

    // Stateless: there is no session to stream (GET) or terminate (DELETE).
    if (request.method !== 'POST') return methodNotAllowed()

    let authInfo
    try {
      authInfo = await verifyBearerToken(request.headers.get('authorization'), {
        verifier: options.verifier,
        resourceMetadataUrl,
      })
    } catch (error) {
      return bearerAuthChallengeResponse(error, { resourceMetadataUrl })
    }
    return mcp.fetch(request, { authInfo })
  }
}
