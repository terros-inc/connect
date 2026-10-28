import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { AuthRequiredError, refreshTokens } from './auth0.ts'
import { getTokens, saveTokens } from './index.ts'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
}))
vi.mock('./auth0.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth0.ts')>()),
  refreshTokens: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getTokens', () => {
  it('returns null when no saved login exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    expect(await getTokens()).toBeNull()
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('returns null when the saved login is not valid JSON', async () => {
    vi.mocked(readFile).mockResolvedValue('{')
    expect(await getTokens()).toBeNull()
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it.each([-1, 4])('refreshes a token expiring in %i minutes', async (minutes) => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expires_at: Date.now() + minutes * 60000,
      })
    )
    vi.mocked(refreshTokens).mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'refresh-token',
      id_token: undefined,
      token_type: 'Bearer',
      expires_in: 3600,
    })
    expect((await getTokens())?.access_token).toBe('new-token')
    expect(refreshTokens).toHaveBeenCalledWith('refresh-token')
    expect(writeFile).toHaveBeenCalled()
  })

  // Guards against concurrent API calls (e.g. `terros whoami` while impersonating) each spending the rotating
  // refresh token, where the losing refresh fails or saves a superseded login to auth.json.
  it('shares one refresh between concurrent callers', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ refresh_token: 'refresh-token', expires_at: 0 }))
    vi.mocked(refreshTokens).mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'rotated-refresh-token',
      id_token: undefined,
      token_type: 'Bearer',
      expires_in: 3600,
    })
    const results = await Promise.all([getTokens(), getTokens()])
    expect(results.map((tokens) => tokens?.access_token)).toEqual(['new-token', 'new-token'])
    expect(refreshTokens).toHaveBeenCalledOnce()
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('reuses tokens that remain valid beyond the refresh window', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ access_token: 'valid-token', expires_at: Date.now() + 3600000 })
    )
    expect((await getTokens())?.access_token).toBe('valid-token')
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('propagates refresh failures without overwriting the saved login', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ refresh_token: 'expired', expires_at: 0 }))
    vi.mocked(refreshTokens).mockRejectedValue(new Error('Unable to refresh token'))
    await expect(getTokens()).rejects.toThrow('Unable to refresh token')
    expect(writeFile).not.toHaveBeenCalled()
  })

  // Guards against a command refreshing a dead token twice (schema load, then its own request), and against an Auth0
  // outage or a dead session being remembered so a long-running process can't recover once it clears.
  it('does not resend a refresh token Auth0 rejected, but retries other failures and new logins', async () => {
    const login = (refreshToken: string) => JSON.stringify({ refresh_token: refreshToken, expires_at: 0 })
    vi.mocked(readFile).mockResolvedValue(login('outage-refresh-token'))
    vi.mocked(refreshTokens).mockRejectedValue(new Error('Unable to refresh the Terros session'))
    await expect(getTokens()).rejects.toThrow('Unable to refresh the Terros session')
    await expect(getTokens()).rejects.toThrow('Unable to refresh the Terros session')
    expect(refreshTokens).toHaveBeenCalledTimes(2)

    vi.mocked(refreshTokens).mockClear()
    vi.mocked(readFile).mockResolvedValue(login('dead-refresh-token'))
    vi.mocked(refreshTokens).mockRejectedValue(new AuthRequiredError('expired'))
    await expect(getTokens()).rejects.toThrow(AuthRequiredError)
    await expect(getTokens()).rejects.toThrow(AuthRequiredError)
    expect(refreshTokens).toHaveBeenCalledOnce()

    vi.mocked(readFile).mockResolvedValue(login('new-refresh-token'))
    await expect(getTokens()).rejects.toThrow(AuthRequiredError)
    expect(refreshTokens).toHaveBeenLastCalledWith('new-refresh-token')
  })
})

describe('saveTokens', () => {
  it('persists login tokens with a computed expiry and private permissions', async () => {
    const now = Date.now()
    const tokens = await saveTokens({
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      id_token: undefined,
      token_type: 'Bearer',
      expires_in: 3600,
    })
    expect(tokens.expires_at).toBeGreaterThanOrEqual(now + 3600000)
    expect(tokens.expires_at).toBeLessThanOrEqual(Date.now() + 3600000)
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.config/terros'), { recursive: true, mode: 0o700 })
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('auth.json'), JSON.stringify(tokens), {
      mode: 0o600,
    })
    expect(chmod).toHaveBeenCalledWith(expect.stringContaining('auth.json'), 0o600)
  })
})
