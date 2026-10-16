import { afterEach, expect, vi } from 'vitest'
import { DateTime } from 'luxon'
import { pollForToken } from './auth0'

vi.mock('open', () => ({ default: vi.fn() }))
vi.mock('@terros-inc/connect-common/auth', () => ({
  AUTH0_CLIENT_ID: 'client-id',
  AUTH0_DOMAIN: 'https://login.example.test',
}))

function tokenError(error: string, error_description?: string): Response {
  return new Response(JSON.stringify({ error, error_description }), { status: 400 })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pollForToken', () => {
  it('stops with the provider reason on a denial or an unexpected error', async () => {
    const deadline = DateTime.now().plus({ minutes: 5 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenError('authorization_pending'))
      .mockResolvedValueOnce(tokenError('access_denied', 'Developer mode is not enabled'))
      .mockResolvedValueOnce(tokenError('expired_token'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pollForToken(deadline, 0, 'device-code')).rejects.toThrow(
      "Sign-in denied: Developer mode is not enabled\nYou may need developer mode turned on for your Terros account. Ask your company admin if you can't turn it on."
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(pollForToken(deadline, 0, 'device-code')).rejects.toThrow(/^Sign-in failed: expired_token$/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
