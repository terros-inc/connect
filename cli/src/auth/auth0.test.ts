import { afterEach, expect, vi } from 'vitest'
import open from 'open'
import { DateTime } from 'luxon'
import { pollForToken, signInToAuth0 } from './auth0'

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
  vi.restoreAllMocks()
})

describe('signInToAuth0', () => {
  // Guards against opening or printing the pre-filled link, which lets a phisher's link get approved with one click.
  it('opens and prints the sign-in page without the code and prints the code to type', async () => {
    const deviceCode = {
      device_code: 'device-code',
      user_code: 'ABCD-EFGH',
      expires_in: 300,
      interval: 0,
      verification_uri: 'https://login.example.test/activate',
      verification_uri_complete: 'https://login.example.test/activate?user_code=ABCD-EFGH',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(deviceCode)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-placeholder' })))
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await signInToAuth0()

    expect(open).toHaveBeenCalledWith('https://login.example.test/activate')
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('ABCD-EFGH')
    expect(output).toContain('https://login.example.test/activate')
    expect(output).not.toContain('user_code=')
  })
})

describe('pollForToken', () => {
  it('stops with the provider reason on a denial or an unexpected error', async () => {
    const deadline = DateTime.now().plus({ minutes: 5 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenError('authorization_pending'))
      .mockResolvedValueOnce(tokenError('access_denied', 'Access is off for this user'))
      .mockResolvedValueOnce(tokenError('expired_token'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pollForToken(deadline, 0, 'device-code')).rejects.toThrow(
      /^Sign-in denied: Access is off for this user$/
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(pollForToken(deadline, 0, 'device-code')).rejects.toThrow(/^Sign-in failed: expired_token$/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
