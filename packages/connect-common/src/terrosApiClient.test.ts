import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerrosApiClient } from './terrosApiClient.ts'
import { getTokens } from './oauth/tokens.ts'
import type { TerrosApiError } from './models.ts'

vi.mock('./oauth/tokens.ts', () => ({ getTokens: vi.fn() }))

describe('TerrosApiClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.TERROS_SDK_BASE_URL
  })

  function mockFetch(body: unknown, ok = true): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve(body),
    }) as unknown as typeof fetch
  }

  it('makes an authenticated GET without a request body', async () => {
    mockFetch({ openapi: '3.1.1', paths: {} })
    vi.mocked(getTokens).mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: undefined,
      token_type: 'Bearer',
      expires_at: Date.now() + 3600000,
    })
    const caller = new TerrosApiClient({ baseUrl: 'https://api.terros.com' })

    await expect(caller.get('openapi')).resolves.toMatchObject({ openapi: '3.1.1' })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.terros.com/openapi', {
      method: 'GET',
      headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      body: undefined,
    })
  })

  it('rejects an unauthorized schema GET', async () => {
    mockFetch({}, false)
    const caller = new TerrosApiClient({ apiKey: 'test-key' })
    await expect(caller.get('openapi')).rejects.toThrow('Bad Request')
  })

  it('sends a POST with the route, headers, and JSON body, returning the parsed success', async () => {
    mockFetch({ type: 'success', value: 42 })
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://api.terros.com' })

    const result = await caller.call('user/get', { userId: 'U:1' })

    expect(result).toEqual({ type: 'success', value: 42 })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.terros.com/user/get', {
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        authorization: 'ApiKey test-key',
      }),
      body: JSON.stringify({ userId: 'U:1' }),
    })
  })

  it('uses the configured authorization type', async () => {
    mockFetch({ type: 'success' })
    const caller = new TerrosApiClient({
      apiKey: 'test-key',
      authType: 'ConnectKey',
      baseUrl: 'https://api.terros.com',
    })

    await caller.call('user/get', {})

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.terros.com/user/get',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'ConnectKey test-key' }),
      })
    )
  })

  it('rejects untrusted hosts before sending any credentials', () => {
    for (const config of [{}, { apiKey: 'key' }, { accessToken: 'token' }]) {
      expect(() => new TerrosApiClient({ ...config, baseUrl: 'https://collector.example.test' })).toThrow(
        /Unsupported API host/
      )
    }
  })

  it('selects the key for the effective host instead of the production key', async () => {
    mockFetch({ type: 'success' })
    vi.stubEnv('TERROS_API_KEY', 'production-key')
    vi.stubEnv('TERROS_API_KEY_STAGE_STAGING', 'staging-key')
    await new TerrosApiClient({ baseUrl: 'https://api.staging.terros.com' }).get('openapi')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'ApiKey staging-key' }) })
    )
    vi.unstubAllEnvs()
  })

  it('does not use the production key when a staging key is absent', async () => {
    mockFetch({ type: 'success' })
    vi.stubEnv('TERROS_API_KEY', 'production-key')
    vi.stubEnv('TERROS_API_KEY_STAGE_STAGING', '')
    vi.mocked(getTokens).mockResolvedValue(null)
    await expect(new TerrosApiClient({ baseUrl: 'https://api.staging.terros.com' }).get('openapi')).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('uses a separate key for each localhost port and the localhost stack', async () => {
    mockFetch({ type: 'success' })
    vi.stubEnv('TERROS_API_KEY_STAGE_LOCALHOST', 'stack-key')
    vi.stubEnv('TERROS_API_KEY_PORT_3000', 'port-3000-key')
    vi.stubEnv('TERROS_API_KEY_PORT_3001', 'port-3001-key')
    vi.stubEnv('TERROS_API_KEY_STAGE_LOCALHOST_3000', 'stack-localhost-3000-key')
    vi.stubEnv('TERROS_API_KEY_STAGE_PORT_3000', 'stack-port-3000-key')
    await [
      ['http://localhost:3000', 'port-3000-key'],
      ['http://localhost:3001', 'port-3001-key'],
      ['https://api.localhost.terros.com', 'stack-key'],
      ['https://api.localhost-3000.terros.com', 'stack-localhost-3000-key'],
      ['https://api.port-3000.terros.com', 'stack-port-3000-key'],
    ].reduce(
      (previous, [baseUrl, key]) =>
        previous.then(async () => {
          await new TerrosApiClient({ baseUrl }).get('openapi')
          expect(globalThis.fetch).toHaveBeenLastCalledWith(
            `${baseUrl}/openapi`,
            expect.objectContaining({ headers: expect.objectContaining({ authorization: `ApiKey ${key}` }) })
          )
        }),
      Promise.resolve()
    )
    vi.unstubAllEnvs()
  })

  // Guards the CLI's step-up for API-key issuance: losing TERROS_IMPERSONATE would issue the key to the staff member,
  // losing TERROS_API_ENDPOINT would send it to production, and an API key in the environment must not win.
  it('sends a one-off access token, keeping the impersonated user and endpoint from the environment', async () => {
    mockFetch({ type: 'success' })
    vi.stubEnv('TERROS_API_KEY', 'env-key')
    vi.stubEnv('TERROS_IMPERSONATE', 'U.example')
    vi.stubEnv('TERROS_API_ENDPOINT', 'api.staging.terros.com')
    vi.mocked(getTokens).mockClear()

    await new TerrosApiClient({ accessToken: 'step-up-token' }).call('apikey/restricted/add', {})

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.staging.terros.com/apikey/restricted/add',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer step-up-token', impersonate_user_id: 'U.example' }),
      })
    )
    expect(getTokens).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('includes analytics headers describing the platform and SDK version', async () => {
    mockFetch({ type: 'success', value: 42 })
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://api.terros.com' })

    await caller.call('user/get', { userId: 'U:1' })

    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit]
    expect(options.headers).toMatchObject({
      'Terros-Bundle-Identifier': 'com.terros.sdk',
      'Terros-Platform': expect.any(String),
      'Terros-Platform-Version': expect.any(String),
    })
  })

  it('wraps a network failure in an Error with the underlying cause', async () => {
    const networkError = new TypeError('fetch failed')
    globalThis.fetch = vi.fn().mockRejectedValue(networkError) as unknown as typeof fetch
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://api.terros.com' })

    await expect(caller.call('user/get', {})).rejects.toThrow('Request to user/get failed')
    await expect(caller.call('user/get', {})).rejects.toMatchObject({ cause: networkError })
  })

  it('throws with the status text on a non-ok response', async () => {
    mockFetch({}, false)
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://api.terros.com' })

    await expect(caller.call('user/get', {})).rejects.toThrow('Bad Request')
    await expect(caller.call('user/get', {})).rejects.toMatchObject({ status: 400 })
  })

  it.each([
    { status: 401, statusText: 'Unauthorized' },
    { status: 403, statusText: 'Forbidden' },
    { status: 401, statusText: '' },
    { status: 403, statusText: '' },
  ])(
    'reports an invalid API key for HTTP $status even with reason phrase "$statusText"',
    async ({ status, statusText }) => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status, statusText }))
      const caller = new TerrosApiClient({ apiKey: 'test-key' })

      await expect(caller.call('user/profile', {})).rejects.toMatchObject({
        message: 'Invalid or unauthorized API key',
        status,
      })
      await expect(caller.get('openapi')).rejects.toMatchObject({
        message: 'Invalid or unauthorized API key',
        status,
      })
    }
  )

  it('does not mislabel a bearer-token permission failure as an invalid API key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }))
    const caller = new TerrosApiClient({ accessToken: 'access-token-example' })

    await expect(caller.call('user/profile', {})).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
  })

  it('preserves the typed API error for CLI and MCP callers', async () => {
    mockFetch({ type: 'error', error: 'impersonation_not_allowed', message: 'Impersonation is not allowed' })
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://api.terros.com' })

    await expect(caller.call('user/get', {})).rejects.toMatchObject({
      name: 'TerrosApiError',
      code: 'impersonation_not_allowed',
      message: 'impersonation_not_allowed: Impersonation is not allowed',
      response: { type: 'error', error: 'impersonation_not_allowed' },
    } satisfies Partial<TerrosApiError>)
  })

  describe('resolveBaseUrl precedence', () => {
    beforeEach(() => {
      process.env = {}
      mockFetch({ type: 'success' })
    })

    it('prefers the explicit config baseUrl over the env var and default', async () => {
      process.env.TERROS_SDK_BASE_URL = 'https://env.example.com'
      const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://api.staging.terros.com' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('https://api.staging.terros.com/user/get', expect.anything())
    })

    it('falls back to the env var when no baseUrl is configured', async () => {
      process.env.TERROS_API_ENDPOINT = 'http://localhost:3000'
      const caller = new TerrosApiClient({ apiKey: 'test-key' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:3000/user/get', expect.anything())
    })

    it('adds the HTTPS protocol when the env var contains a bare hostname', async () => {
      process.env.TERROS_API_ENDPOINT = 'api.staging.terros.com'
      const caller = new TerrosApiClient({ apiKey: 'test-key' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('https://api.staging.terros.com/user/get', expect.anything())
    })

    it('falls back to the prod default when neither baseUrl nor env var is set', async () => {
      const caller = new TerrosApiClient({ apiKey: 'test-key' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('https://api.terros.com/user/get', expect.anything())
    })
  })
})
