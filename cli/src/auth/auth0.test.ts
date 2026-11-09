import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import open from 'open'
import { DateTime } from 'luxon'
import { getTokens } from '@terros-inc/connect-common/auth'
import { pollForToken, signInToAuth0, signInWithSensitiveScope } from './auth0'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.dir,
}))
vi.mock('open', () => ({ default: vi.fn() }))
vi.mock('@terros-inc/connect-common/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@terros-inc/connect-common/auth')>()),
  AUTH0_CLIENT_ID: 'client-id',
  AUTH0_DOMAIN: 'https://login.example.test',
}))

const deviceCode = {
  device_code: 'device-code',
  user_code: 'ABCD-EFGH',
  expires_in: 300,
  interval: 0,
  verification_uri: 'https://login.example.test/activate',
  verification_uri_complete: 'https://login.example.test/activate?user_code=ABCD-EFGH',
}

/** An unsigned access token with the given scope claim; only its payload is read. */
function accessToken(scope: string): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ scope })}.signature`
}

function tokenError(error: string, error_description?: string): Response {
  return new Response(JSON.stringify({ error, error_description }), { status: 400 })
}

beforeEach(async () => {
  home.dir = await mkdtemp(join(tmpdir(), 'terros-auth0-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await rm(home.dir, { recursive: true, force: true })
})

describe('signInToAuth0', () => {
  // Guards against opening or printing the pre-filled link, which lets a phisher's link get approved with one click.
  it('opens and prints the sign-in page without the code and prints the code to type', async () => {
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

describe('signInWithSensitiveScope', () => {
  const signIn = (token: Response): ReturnType<typeof vi.fn> => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(deviceCode)))
      .mockResolvedValueOnce(token)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  // Guards against a step-up Auth0 answers without sensitive:manage (no API audience) or one that prints its prompts to
  // standard output, where they would corrupt the key piped into a secret store.
  it('asks for sensitive:manage for the API and returns the token, keeping standard output clean', async () => {
    const token = accessToken('offline_access sensitive:manage')
    const fetchMock = signIn(new Response(JSON.stringify({ access_token: token })))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(signInWithSensitiveScope()).resolves.toBe(token)

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      client_id: 'client-id',
      scope: 'offline_access sensitive:manage',
      audience: 'https://api.tantalim.com',
    })
    expect(log).not.toHaveBeenCalled()
    const prompts = error.mock.calls.flat().join('\n')
    expect(prompts).toContain('ABCD-EFGH')
    expect(prompts).not.toContain(token)
  })

  // Guards against the elevated sign-in replacing or downgrading the saved login, or being saved where a later refresh
  // would keep using it without sensitive:manage.
  it('leaves the saved login as it was', async () => {
    const configDir = join(home.dir, '.config', 'terros')
    const saved = JSON.stringify({
      access_token: 'saved-token',
      refresh_token: 'saved-refresh-token',
      token_type: 'Bearer',
      expires_at: Date.now() + 3_600_000,
    })
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'auth.json'), saved)
    const token = accessToken('offline_access sensitive:manage')
    signIn(new Response(JSON.stringify({ access_token: token, refresh_token: 'elevated-refresh-token' })))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(signInWithSensitiveScope()).resolves.toBe(token)

    expect(await readdir(configDir)).toEqual(['auth.json'])
    expect(await readFile(join(configDir, 'auth.json'), 'utf-8')).toBe(saved)
    expect((await getTokens())?.access_token).toBe('saved-token')
  })

  // Auth0 drops a scope the application may not request; the API would then refuse without naming the scope.
  it.each([['offline_access'], ['offline_access sensitive:manager']])(
    'names the missing scope when the token grants %s',
    async (scope) => {
      signIn(new Response(JSON.stringify({ access_token: accessToken(scope) })))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(signInWithSensitiveScope()).rejects.toThrow(/^Sign-in did not grant the sensitive:manage scope/)
    }
  )

  it('names the scope when the sign-in request is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(tokenError('invalid_scope', 'Scope not allowed')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(signInWithSensitiveScope()).rejects.toThrow(
      'Sign-in for the sensitive:manage scope failed: Failed to get OAuth device code: Scope not allowed'
    )
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
