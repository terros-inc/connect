import { SignJWT, createLocalJWKSet, decodeProtectedHeader, exportJWK, generateKeyPair } from 'jose'
import * as core from '@terros-inc/mcp-core'
import type { EndpointGroups } from '@terros-inc/mcp-core'
import { createRemoteMcpHandler, type RemoteMcpHandler } from './handler.ts'
import { createAuth0TokenExchange, MCP_SUBJECT_TOKEN_TYPE } from './exchange.ts'
import { readConfig, type ServerConfig } from './config.ts'
import { createAuth0Verifier } from './auth.ts'

vi.mock('@terros-inc/mcp-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@terros-inc/mcp-core')>()
  return { ...actual, createMcpServer: vi.fn(actual.createMcpServer) }
})

const ISSUER = 'https://auth.example.test/'
const HOST = 'mcp.example.test'
const AUDIENCE = `https://${HOST}`
const API_AUDIENCE = 'https://api.example.test'

const config: ServerConfig = {
  resource: AUDIENCE,
  apiBaseUrl: 'https://api.example.test',
  issuer: ISSUER,
  apiAudience: API_AUDIENCE,
  tokenExchangeClientId: 'exchange-client',
  tokenExchangeSecretId: 'terros-mcp/test/auth0-token-exchange',
  allowedOrigins: [HOST, 'app.example.test'],
}

const endpoints: EndpointGroups = {
  account: {
    get: {
      path: '/account/get',
      description: 'Get an account',
      properties: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      components: { schemas: {} },
    },
  },
}

const { privateKey, publicKey } = await generateKeyPair('RS256')
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }] })

type TokenOverrides = {
  audience?: string
  issuer?: string
  expires?: boolean
  expiresAt?: number
  /** Header `typ`; RFC 9068 access tokens carry `at+jwt`, Auth0-profile tokens `JWT`. */
  typ?: string
  /** Claims to set or, with `undefined`, to leave out. */
  claims?: Record<string, unknown>
}

/** An Auth0 access token in the RFC 9068 profile (the MCP APIs' JWT profile), unless overridden. */
function token(subject: string, overrides: TokenOverrides = {}): Promise<string> {
  const claims = Object.fromEntries(
    Object.entries({ client_id: 'test-client', jti: crypto.randomUUID(), ...overrides.claims }).filter(
      ([, value]) => value !== undefined
    )
  )
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test', typ: overrides.typ ?? 'at+jwt' })
    .setSubject(subject)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt()
  if (overrides.expires === false) return jwt.sign(privateKey)
  return jwt.setExpirationTime(overrides.expiresAt ?? '5m').sign(privateKey)
}

/** The Terros API token Auth0 issues in exchange for a subject (MCP-audience) token. */
function exchanged(subjectToken: string): string {
  return `api-token-for-${JSON.parse(atob(subjectToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).sub}`
}

const apiFetch = vi.fn<typeof fetch>()
/** Mocked Auth0 token endpoint. */
const authFetch = vi.fn<typeof fetch>()
let handle: RemoteMcpHandler

beforeEach(() => {
  vi.mocked(core.createMcpServer).mockClear()
  apiFetch.mockReset()
  apiFetch.mockImplementation(async () => Response.json({ type: 'success', id: 'A.1' }))
  authFetch.mockReset()
  authFetch.mockImplementation(async (_, init) => {
    const form = new URLSearchParams(String(init?.body))
    return Response.json({ access_token: exchanged(form.get('subject_token')!), token_type: 'Bearer', expires_in: 300 })
  })
  handle = createRemoteMcpHandler({
    config,
    endpoints: async () => endpoints,
    verifier: createAuth0Verifier({ issuer: ISSUER, audience: AUDIENCE, keys }),
    exchangeToken: createAuth0TokenExchange({
      issuer: ISSUER,
      audience: API_AUDIENCE,
      clientId: 'exchange-client',
      clientSecret: async () => 'exchange-secret',
      fetch: authFetch,
    }),
    version: '1.2.3',
    fetch: apiFetch,
  })
})

function request(
  method: string,
  init: { path?: string; headers?: Record<string, string>; body?: unknown } = {}
): Request {
  return new Request(`https://${HOST}${init.path ?? '/'}`, {
    method,
    headers: {
      host: HOST,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

function rpc(method: string, params: object, accessToken?: string, id = 1): Request {
  return request('POST', {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    body: { jsonrpc: '2.0', id, method, params },
  })
}

/** Read a JSON-RPC reply, whether it came back as JSON or as a single-message SSE stream. */
async function reply(response: Response): Promise<any> {
  const text = await response.text()
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(text)
  const data = text.split('\n').find((line) => line.startsWith('data: '))
  return JSON.parse(data!.slice('data: '.length))
}

const initialize = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'test', version: '1.0.0' },
}

describe('method handling', () => {
  it.each(['GET', 'DELETE'])('answers %s / with 405 and a JSON-RPC error before authentication', async (method) => {
    const response = await handle(request(method))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    })
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it('serves an unauthenticated health check', async () => {
    const response = await handle(request('GET', { path: '/health' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: '1.2.3' })
  })

  it.each(['/mcp', '/other'])('returns 404 for %s, with no alias for the old path', async (path) => {
    expect((await handle(request('POST', { path, body: {} }))).status).toBe(404)
  })
})

describe('authentication', () => {
  it('challenges a request without a token and points at the protected resource metadata', async () => {
    const response = await handle(rpc('initialize', initialize))
    expect(response.status).toBe(401)
    const challenge = response.headers.get('www-authenticate')
    expect(challenge).toContain(`resource_metadata="https://${HOST}/.well-known/oauth-protected-resource"`)
    expect(challenge).not.toContain('scope=')
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it.each<[string, TokenOverrides]>([
    ['another audience', { audience: 'https://api.example.test' }],
    ['another issuer', { issuer: 'https://evil.example.test/' }],
    ['no expiry', { expires: false }],
    ['an expired token', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    [
      'the Auth0 profile instead of RFC 9068',
      { typ: 'JWT', claims: { client_id: undefined, jti: undefined, azp: 'test-client' } },
    ],
  ])('rejects a token for %s', async (_, overrides) => {
    const response = await handle(rpc('initialize', initialize, await token('user-1', overrides)))
    expect(response.status).toBe(401)
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it('serves protected resource metadata at the bare well-known path, naming the Auth0 issuer', async () => {
    const response = await handle(request('GET', { path: '/.well-known/oauth-protected-resource' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual({
      resource: `https://${HOST}`,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      resource_name: 'Terros',
    })
  })

  it('serves no authorization server metadata of its own', async () => {
    const response = await handle(request('GET', { path: '/.well-known/oauth-authorization-server' }))
    expect(response.status).toBe(404)
  })
})

describe('per-request servers', () => {
  it('initializes a fresh server for an authenticated request', async () => {
    const response = await handle(rpc('initialize', initialize, await token('user-1')))
    expect(response.status).toBe(200)
    expect(await reply(response)).toMatchObject({ result: { serverInfo: { name: 'terros', version: '1.2.3' } } })
    expect(core.createMcpServer).toHaveBeenCalledOnce()
  })

  it('lists the endpoint tools', async () => {
    const response = await handle(rpc('tools/list', {}, await token('user-1')))
    expect(await reply(response)).toMatchObject({ result: { tools: [{ name: 'account_get' }] } })
  })

  it("calls the API with each request's own token and builds a server per request", async () => {
    const original = process.env.TERROS_API_KEY
    process.env.TERROS_API_KEY = 'server-wide-key'
    try {
      const first = await token('user-1')
      const second = await token('user-2')
      const replies = await Promise.all(
        [first, second].map(async (accessToken) =>
          reply(await handle(rpc('tools/call', { name: 'account_get', arguments: { id: 'A.1' } }, accessToken)))
        )
      )
      for (const result of replies) {
        expect(result).toMatchObject({ result: { content: [{ type: 'text', text: '{"type":"success","id":"A.1"}' }] } })
      }

      expect(core.createMcpServer).toHaveBeenCalledTimes(2)
      const [firstOptions, secondOptions] = vi.mocked(core.createMcpServer).mock.calls.map(([options]) => options)
      expect(firstOptions!.client).not.toBe(secondOptions!.client)

      const sent = apiFetch.mock.calls.map(([url, init]) => ({
        url,
        authorization: new Headers(init?.headers).get('authorization'),
      }))
      expect(sent).toHaveLength(2)
      expect(sent).toEqual(
        expect.arrayContaining([
          { url: 'https://api.example.test/account/get', authorization: 'Bearer api-token-for-user-1' },
          { url: 'https://api.example.test/account/get', authorization: 'Bearer api-token-for-user-2' },
        ])
      )

      // Each request exchanged its own MCP token at Auth0; neither MCP token was sent to the API.
      const exchanges = authFetch.mock.calls.map(([url, init]) => ({
        url,
        form: Object.fromEntries(new URLSearchParams(String(init?.body))),
      }))
      expect(exchanges).toHaveLength(2)
      for (const subjectToken of [first, second]) {
        expect(exchanges).toContainEqual({
          url: `${ISSUER}oauth/token`,
          form: {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: subjectToken,
            subject_token_type: MCP_SUBJECT_TOKEN_TYPE,
            audience: API_AUDIENCE,
            client_id: 'exchange-client',
            client_secret: 'exchange-secret',
          },
        })
      }
      const apiTraffic = JSON.stringify(apiFetch.mock.calls)
      expect(apiTraffic).not.toContain(first)
      expect(apiTraffic).not.toContain(second)
      expect(apiTraffic).not.toContain('server-wide-key')
    } finally {
      if (original === undefined) delete process.env.TERROS_API_KEY
      else process.env.TERROS_API_KEY = original
    }
  })

  it('does not exchange tokens for requests that call no API', async () => {
    const accessToken = await token('user-1')
    await reply(await handle(rpc('initialize', initialize, accessToken)))
    await reply(await handle(rpc('tools/list', {}, accessToken)))
    expect(authFetch).not.toHaveBeenCalled()
  })

  it('exchanges once per request, however many API calls it makes', async () => {
    const client = vi.mocked(core.createMcpServer)
    await reply(
      await handle(rpc('tools/call', { name: 'account_get', arguments: { id: 'A.1' } }, await token('user-1')))
    )
    const { client: apiClient } = client.mock.calls[0]![0]
    await apiClient.call('/account/get', { id: 'A.2' })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(authFetch).toHaveBeenCalledOnce()
  })

  it('reports a refused token exchange as a tool error without calling the API', async () => {
    authFetch.mockResolvedValue(
      Response.json({ error: 'invalid_request', error_description: 'Invalid subject_token' }, { status: 400 })
    )
    const response = await handle(
      rpc('tools/call', { name: 'account_get', arguments: { id: 'A.1' } }, await token('user-1'))
    )
    expect(await reply(response)).toMatchObject({
      result: {
        isError: true,
        content: [{ type: 'text', text: 'Terros API authorization failed (invalid_request: Invalid subject_token)' }],
      },
    })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('returns API errors as tool errors', async () => {
    apiFetch.mockResolvedValue(Response.json({ type: 'error', error: 'not_found', message: 'Account not found' }))
    const response = await handle(
      rpc('tools/call', { name: 'account_get', arguments: { id: 'A.1' } }, await token('user-1'))
    )
    expect(await reply(response)).toMatchObject({
      result: { isError: true, content: [{ type: 'text', text: 'Account not found' }] },
    })
  })
})

describe('host and origin protection', () => {
  it('rejects a request for another Host (DNS rebinding)', async () => {
    const response = await handle(request('POST', { headers: { host: 'rebound.example.test' }, body: {} }))
    expect(response.status).toBe(403)
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it.each(['https://evil.example.test', 'http://app.example.test', 'https://app.example.test:8443', 'null'])(
    'rejects the browser Origin %s',
    async (origin) => {
      const response = await handle(request('POST', { headers: { origin }, body: {} }))
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  )

  it('accepts an allowed browser Origin and lets it read the response', async () => {
    const response = await handle(request('GET', { path: '/health', headers: { origin: 'https://app.example.test' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test')
    expect(response.headers.get('vary')).toContain('Origin')
  })

  it('answers a CORS preflight from an allowed origin without authentication', async () => {
    const response = await handle(request('OPTIONS', { headers: { origin: 'https://app.example.test' } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test')
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate')
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it('exposes the auth challenge to an allowed origin', async () => {
    const response = await handle(
      request('POST', {
        headers: { origin: 'https://app.example.test' },
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test')
  })

  it('adds no CORS headers for non-browser clients', async () => {
    const response = await handle(request('GET', { path: '/health' }))
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('createAuth0Verifier', () => {
  const verifier = createAuth0Verifier({ issuer: ISSUER, audience: AUDIENCE, keys })

  it('accepts an RFC 9068 access token (typ at+jwt, client_id, jti)', async () => {
    const accessToken = await token('user-1')
    expect(decodeProtectedHeader(accessToken)).toMatchObject({ typ: 'at+jwt' })
    const info = await verifier.verifyAccessToken(accessToken)
    expect(info).toMatchObject({ token: accessToken, clientId: 'test-client', scopes: [] })
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000)
  })

  it('accepts the application/at+jwt spelling of the header type', async () => {
    await expect(
      verifier.verifyAccessToken(await token('user-1', { typ: 'application/at+jwt' }))
    ).resolves.toMatchObject({ clientId: 'test-client' })
  })

  it.each<[string, TokenOverrides]>([
    ['without exp', { expires: false }],
    ['past its exp', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['for another audience', { audience: 'https://api.example.test' }],
    ['from another issuer', { issuer: 'https://other.example.test/' }],
    [
      'in the Auth0 profile (typ JWT, azp, no jti)',
      { typ: 'JWT', claims: { client_id: undefined, jti: undefined, azp: 'test-client' } },
    ],
    ['without a typ header of at+jwt', { typ: 'JWT' }],
    ['without client_id', { claims: { client_id: undefined, azp: 'test-client' } }],
    ['without jti', { claims: { jti: undefined } }],
  ])('rejects a token %s itself, not only through the SDK check', async (_, overrides) => {
    await expect(verifier.verifyAccessToken(await token('user-1', overrides))).rejects.toThrow('Invalid access token')
  })

  it('rejects a token signed with another key', async () => {
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ client_id: 'test-client', jti: 'forged' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test', typ: 'at+jwt' })
      .setSubject('user-1')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(other.privateKey)
    await expect(verifier.verifyAccessToken(forged)).rejects.toThrow('Invalid access token')
  })
})

describe('readConfig', () => {
  const env = {
    MCP_RESOURCE_URL: `https://${HOST}/`,
    TERROS_API_ENDPOINT: 'https://api.example.test/',
    AUTH0_ISSUER: 'https://auth.example.test',
    TERROS_API_AUDIENCE: API_AUDIENCE,
    AUTH0_TOKEN_EXCHANGE_CLIENT_ID: 'exchange-client',
    AUTH0_TOKEN_EXCHANGE_SECRET_ID: 'terros-mcp/test/auth0-token-exchange',
    MCP_ALLOWED_ORIGINS: 'app.example.test, ',
  }

  it('reads the deployment configuration, with the resource as a bare origin', () => {
    expect(readConfig(env)).toEqual(config)
  })

  it.each(['https://mcp.example.test/mcp', 'http://mcp.example.test'])('rejects the resource URL %s', (url) => {
    expect(() => readConfig({ ...env, MCP_RESOURCE_URL: url })).toThrow('MCP_RESOURCE_URL')
  })

  it('refuses to start with a server-wide API key', () => {
    expect(() => readConfig({ ...env, TERROS_API_KEY: 'server-wide-key' })).toThrow('TERROS_API_KEY')
  })

  it.each(['TERROS_API_AUDIENCE', 'AUTH0_TOKEN_EXCHANGE_CLIENT_ID', 'AUTH0_TOKEN_EXCHANGE_SECRET_ID'])(
    'requires %s',
    (name) => {
      expect(() => readConfig({ ...env, [name]: '' })).toThrow(name)
    }
  )
})
