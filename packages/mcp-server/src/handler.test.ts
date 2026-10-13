import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import * as core from '@terros-inc/mcp-core'
import type { EndpointGroups } from '@terros-inc/mcp-core'
import { createRemoteMcpHandler, type RemoteMcpHandler } from './handler.ts'
import { readConfig, type ServerConfig } from './config.ts'
import { createAuth0Verifier } from './auth.ts'

vi.mock('@terros-inc/mcp-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@terros-inc/mcp-core')>()
  return { ...actual, createMcpServer: vi.fn(actual.createMcpServer) }
})

const ISSUER = 'https://auth.example.test/'
const AUDIENCE = 'https://mcp.example.test/mcp'
const HOST = 'mcp.example.test'

const config: ServerConfig = {
  resourceUrl: new URL(`https://${HOST}/mcp`),
  apiBaseUrl: 'https://api.example.test',
  issuer: ISSUER,
  audience: AUDIENCE,
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

function token(
  subject: string,
  overrides: { audience?: string; issuer?: string; expires?: boolean } = {}
): Promise<string> {
  const jwt = new SignJWT({ scope: 'openid', azp: 'test-client' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setSubject(subject)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt()
  return (overrides.expires === false ? jwt : jwt.setExpirationTime('5m')).sign(privateKey)
}

const apiFetch = vi.fn<typeof fetch>()
let handle: RemoteMcpHandler

beforeEach(() => {
  vi.mocked(core.createMcpServer).mockClear()
  apiFetch.mockReset()
  apiFetch.mockImplementation(async () => Response.json({ type: 'success', id: 'A.1' }))
  handle = createRemoteMcpHandler({
    config,
    endpoints: async () => endpoints,
    verifier: createAuth0Verifier({ issuer: ISSUER, audience: AUDIENCE, keys }),
    version: '1.2.3',
    fetch: apiFetch,
  })
})

function request(
  method: string,
  init: { path?: string; headers?: Record<string, string>; body?: unknown } = {}
): Request {
  return new Request(`https://${HOST}${init.path ?? '/mcp'}`, {
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
  it.each(['GET', 'DELETE'])('answers %s /mcp with 405 and a JSON-RPC error before authentication', async (method) => {
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

  it('returns 404 for other paths', async () => {
    expect((await handle(request('POST', { path: '/other', body: {} }))).status).toBe(404)
  })
})

describe('authentication', () => {
  it('challenges a request without a token and points at the protected resource metadata', async () => {
    const response = await handle(rpc('initialize', initialize))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="https://${HOST}/.well-known/oauth-protected-resource/mcp"`
    )
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it.each([
    ['another audience', { audience: 'https://api.example.test' }],
    ['another issuer', { issuer: 'https://evil.example.test/' }],
    ['no expiry', { expires: false }],
  ])('rejects a token for %s', async (_, overrides) => {
    const response = await handle(rpc('initialize', initialize, await token('user-1', overrides)))
    expect(response.status).toBe(401)
    expect(core.createMcpServer).not.toHaveBeenCalled()
  })

  it('serves protected resource metadata naming the Auth0 issuer', async () => {
    const response = await handle(request('GET', { path: '/.well-known/oauth-protected-resource/mcp' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      resource: `https://${HOST}/mcp`,
      authorization_servers: [ISSUER],
    })
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
          { url: 'https://api.example.test/account/get', authorization: `Bearer ${first}` },
          { url: 'https://api.example.test/account/get', authorization: `Bearer ${second}` },
        ])
      )
    } finally {
      if (original === undefined) delete process.env.TERROS_API_KEY
      else process.env.TERROS_API_KEY = original
    }
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

  it('rejects a browser Origin that is not allowed', async () => {
    const response = await handle(request('POST', { headers: { origin: 'https://evil.example.test' }, body: {} }))
    expect(response.status).toBe(403)
  })

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

describe('readConfig', () => {
  const env = {
    MCP_RESOURCE_URL: `https://${HOST}/mcp`,
    TERROS_API_ENDPOINT: 'https://api.example.test/',
    AUTH0_ISSUER: 'https://auth.example.test',
    AUTH0_AUDIENCE: AUDIENCE,
    MCP_ALLOWED_ORIGINS: 'app.example.test, ',
  }

  it('reads the deployment configuration', () => {
    expect(readConfig(env)).toEqual(config)
  })

  it('refuses to start with a server-wide API key', () => {
    expect(() => readConfig({ ...env, TERROS_API_KEY: 'server-wide-key' })).toThrow('TERROS_API_KEY')
  })

  it('requires the Auth0 audience', () => {
    expect(() => readConfig({ ...env, AUTH0_AUDIENCE: '' })).toThrow('AUTH0_AUDIENCE')
  })
})
