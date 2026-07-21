import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerrosApiClient } from './terrosApiClient.ts'

describe('TerrosApiClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.TERROS_SDK_BASE_URL
  })

  function mockFetch(body: unknown, ok = true): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      statusText: 'Bad Request',
      json: () => Promise.resolve(body),
    }) as unknown as typeof fetch
  }

  it('sends a POST with the route, headers, and JSON body, returning the parsed success', async () => {
    mockFetch({ type: 'success', value: 42 })
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://example.com' })

    const result = await caller.call('user/get', { userId: 'U:1' })

    expect(result).toEqual({ type: 'success', value: 42 })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/user/get', {
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        authorization: 'ApiKey test-key',
      }),
      body: JSON.stringify({ userId: 'U:1' }),
    })
  })

  it('includes analytics headers describing the platform and SDK version', async () => {
    mockFetch({ type: 'success', value: 42 })
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://example.com' })

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
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://example.com' })

    await expect(caller.call('user/get', {})).rejects.toThrow('Request to user/get failed')
    await expect(caller.call('user/get', {})).rejects.toMatchObject({ cause: networkError })
  })

  it('throws with the status text on a non-ok response', async () => {
    mockFetch({}, false)
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://example.com' })

    await expect(caller.call('user/get', {})).rejects.toThrow('Bad Request')
  })

  it('throws with the error message on a ResponseError body', async () => {
    mockFetch({ type: 'error', error: 'not_found', message: 'User not found' })
    const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://example.com' })

    await expect(caller.call('user/get', {})).rejects.toThrow('User not found')
  })

  describe('resolveBaseUrl precedence', () => {
    beforeEach(() => {
      process.env = {}
      mockFetch({ type: 'success' })
    })

    it('prefers the explicit config baseUrl over the env var and default', async () => {
      process.env.TERROS_SDK_BASE_URL = 'https://env.example.com'
      const caller = new TerrosApiClient({ apiKey: 'test-key', baseUrl: 'https://config.example.com' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('https://config.example.com/user/get', expect.anything())
    })

    it('falls back to the env var when no baseUrl is configured', async () => {
      process.env.TERROS_API_ENDPOINT = 'https://env.example.com'
      const caller = new TerrosApiClient({ apiKey: 'test-key' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('https://env.example.com/user/get', expect.anything())
    })

    it('falls back to the prod default when neither baseUrl nor env var is set', async () => {
      const caller = new TerrosApiClient({ apiKey: 'test-key' })

      await caller.call('user/get', {})

      expect(globalThis.fetch).toHaveBeenCalledWith('https://api.terros.com/user/get', expect.anything())
    })
  })
})
