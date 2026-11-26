import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TerrosApiClient } from '../terrosApiClient.ts'
import { AuthRequiredError, refreshTokens } from './auth0.ts'
import type { TokenResponse } from './types.ts'
import { getTokens, saveTokens } from './index.ts'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.dir,
}))
// Passes through to the real file system; a test replaces one read to hand a caller a stale snapshot of auth.json.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile) }
})
vi.mock('./auth0.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth0.ts')>()),
  refreshTokens: vi.fn(),
}))
const realReadFile = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readFile

const rotated: TokenResponse = {
  access_token: 'new-token',
  refresh_token: 'rotated-refresh-token',
  id_token: undefined,
  token_type: 'Bearer',
  expires_in: 3600,
}
const expired = JSON.stringify({ access_token: 'old-token', refresh_token: 'refresh-token-example', expires_at: 0 })

const configDir = (): string => join(home.dir, '.config', 'terros')
const authFile = (): string => join(configDir(), 'auth.json')
const lockFile = (): string => `${authFile()}.lock`
const writeAuth = async (content: string): Promise<void> => {
  await mkdir(configDir(), { recursive: true })
  await writeFile(authFile(), content)
}
const readAuth = async (): Promise<unknown> => JSON.parse(await readFile(authFile(), 'utf-8'))

beforeEach(async () => {
  vi.mocked(refreshTokens).mockReset()
  vi.mocked(readFile).mockReset().mockImplementation(realReadFile)
  home.dir = await mkdtemp(join(tmpdir(), 'terros-tokens-'))
})

afterEach(async () => {
  await rm(home.dir, { recursive: true, force: true })
})

describe('getTokens', () => {
  // Auth0 revokes the whole login when a rotated refresh token is sent again, e.g. by `whoami`'s parallel requests,
  // or by the internal-schema load and the command's request, where the second read auth.json just before the first
  // refresh saved and called after it finished.
  it('sends the refresh token once for concurrent callers and a caller holding a stale read', async () => {
    await writeAuth(expired)
    vi.mocked(refreshTokens).mockResolvedValue(rotated)
    const results = await Promise.all([getTokens(), getTokens()])
    expect(results.map((tokens) => tokens?.access_token)).toEqual(['new-token', 'new-token'])

    vi.mocked(readFile).mockResolvedValueOnce(expired)
    expect((await getTokens())?.access_token).toBe('new-token')
    expect(refreshTokens).toHaveBeenCalledOnce()
  })

  // Guards against two terros processes (two terminals, an agent running commands in parallel) both refreshing
  // with the token they each read from auth.json.
  it('uses tokens another process saved after this one read auth.json', async () => {
    await writeAuth(expired)
    vi.mocked(readFile).mockImplementationOnce(async () => {
      await writeAuth(
        JSON.stringify({ ...rotated, access_token: 'other-process-token', expires_at: Date.now() + 3600000 })
      )
      return expired
    })
    expect((await getTokens())?.access_token).toBe('other-process-token')
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  // Taking over a running process's lock, however old, could send the token it is refreshing with a second time.
  it('waits for a live holder and never takes its lock', async () => {
    await writeAuth(expired)
    const holder = `${process.pid}:other-process`
    await writeFile(lockFile(), holder)
    const anHourAgo = new Date(Date.now() - 3600000)
    await utimes(lockFile(), anHourAgo, anHourAgo)
    const tokens = getTokens()
    const lockReads = (): number => vi.mocked(readFile).mock.calls.filter(([path]) => path === lockFile()).length
    await vi.waitFor(() => expect(lockReads()).toBeGreaterThan(2))
    expect(await readFile(lockFile(), 'utf-8')).toBe(holder)

    await writeAuth(
      JSON.stringify({ ...rotated, access_token: 'other-process-token', expires_at: Date.now() + 3600000 })
    )
    await rm(lockFile())
    expect((await tokens)?.access_token).toBe('other-process-token')
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  // A process killed mid-refresh must not leave every later command waiting on its lock.
  // A process killed mid-takeover leaves its guard file behind too.
  it('takes over a lock left by a process that is no longer running', async () => {
    await writeAuth(expired)
    await writeFile(lockFile(), '999999999:dead-owner')
    await writeFile(`${lockFile()}.dead-owner`, '999999998:dead-taker')
    vi.mocked(refreshTokens).mockResolvedValue(rotated)
    expect((await getTokens())?.access_token).toBe('new-token')
    expect(await readdir(configDir())).toEqual(['auth.json'])
  })

  // A process killed between creating the lock and writing its owner leaves it empty, which must not block every later
  // command's refresh.
  it('takes over an empty lock left long ago', async () => {
    await writeAuth(expired)
    await writeFile(lockFile(), '')
    const twoMinutesAgo = new Date(Date.now() - 120000)
    await utimes(lockFile(), twoMinutesAgo, twoMinutesAgo)
    vi.mocked(refreshTokens).mockResolvedValue(rotated)
    expect((await getTokens())?.access_token).toBe('new-token')
    expect(await readdir(configDir())).toEqual(['auth.json'])
  })

  // Two processes taking over the same dead lock at once: the second must not delete the lock the first has just
  // taken, or both would refresh with the same token.
  it('does not delete a lock another process took while this one was taking over a dead lock', async () => {
    await writeAuth(expired)
    await writeFile(lockFile(), '999999999:dead-owner')
    let otherHoldsLock = false
    let lockReads = 0
    // Runs the other process's takeover, with the same guard file, between this one's ownership check and its remove.
    vi.mocked(readFile).mockImplementation(async (path, options) => {
      const content = await realReadFile(path, options)
      if (path === lockFile() && ++lockReads === 2) {
        try {
          await writeFile(`${lockFile()}.dead-owner`, `${process.pid}:other-taker`, { flag: 'wx' })
          await rm(lockFile())
          await writeFile(lockFile(), `${process.pid}:other-process`, { flag: 'wx' })
          otherHoldsLock = true
        } catch {
          // This process holds the guard, so the other one waits.
        }
      }
      return content
    })
    vi.mocked(refreshTokens).mockImplementation(async () => {
      expect(otherHoldsLock).toBe(false)
      return rotated
    })
    expect((await getTokens())?.access_token).toBe('new-token')
    expect(refreshTokens).toHaveBeenCalledOnce()
  })

  it('keeps the saved refresh token when the refresh response has none', async () => {
    await writeAuth(expired)
    vi.mocked(refreshTokens).mockResolvedValue({ ...rotated, refresh_token: undefined })
    expect((await getTokens())?.refresh_token).toBe('refresh-token-example')
    expect(await readAuth()).toMatchObject({ access_token: 'new-token', refresh_token: 'refresh-token-example' })
  })

  it('propagates refresh failures without overwriting the saved login or keeping the lock', async () => {
    await writeAuth(expired)
    vi.mocked(refreshTokens).mockRejectedValue(new Error('Unable to refresh token'))
    await expect(getTokens()).rejects.toThrow('Unable to refresh token')
    expect(await readFile(authFile(), 'utf-8')).toBe(expired)
    await expect(stat(lockFile())).rejects.toThrow()
  })

  // Guards against resending a refresh token Auth0 rejected, against an Auth0 outage being remembered so a long-running
  // process can't recover once it clears, and against a new login staying blocked after an earlier session was rejected.
  it('never resends a rejected refresh token but retries other failures and new logins', async () => {
    const login = (refreshToken: string): string => JSON.stringify({ refresh_token: refreshToken, expires_at: 0 })
    await writeAuth(login('outage-refresh-token'))
    vi.mocked(refreshTokens).mockRejectedValue(new Error('Unable to refresh the Terros session'))
    await expect(getTokens()).rejects.toThrow('Unable to refresh the Terros session')
    await expect(getTokens()).rejects.toThrow('Unable to refresh the Terros session')
    expect(refreshTokens).toHaveBeenCalledTimes(2)

    await writeAuth(login('dead-refresh-token'))
    vi.mocked(refreshTokens).mockRejectedValue(new AuthRequiredError('expired'))
    await expect(getTokens()).rejects.toThrow(AuthRequiredError)
    await expect(getTokens()).rejects.toThrow(AuthRequiredError)
    expect(refreshTokens).toHaveBeenCalledTimes(3)

    await writeAuth(login('new-refresh-token'))
    await expect(getTokens()).rejects.toThrow(AuthRequiredError)
    expect(refreshTokens).toHaveBeenLastCalledWith('new-refresh-token')
  })
})

describe('saveTokens', () => {
  it('persists login tokens with a computed expiry and private permissions', async () => {
    const now = Date.now()
    const tokens = await saveTokens({ ...rotated, access_token: 'test-token', refresh_token: 'test-refresh' })
    expect(tokens.expires_at).toBeGreaterThanOrEqual(now + 3600000)
    expect(tokens.expires_at).toBeLessThanOrEqual(Date.now() + 3600000)
    expect(await readAuth()).toEqual(tokens)
    expect((await stat(configDir())).mode & 0o777).toBe(0o700)
    expect((await stat(authFile())).mode & 0o777).toBe(0o600)
    expect(await readdir(configDir())).toEqual(['auth.json'])
  })

  it('keeps concurrent refreshes for different backends separate', async () => {
    vi.stubEnv('TERROS_API_ENDPOINT', '')
    vi.stubEnv('TERROS_ENV', 'prod')
    await writeAuth(JSON.stringify({ access_token: 'old-prod', refresh_token: 'prod-refresh', expires_at: 0 }))
    const stagingDir = join(configDir(), 'env', 'staging')
    await mkdir(stagingDir, { recursive: true })
    await writeFile(
      join(stagingDir, 'auth.json'),
      JSON.stringify({ access_token: 'old-stage', refresh_token: 'stage-refresh', expires_at: 0 })
    )
    vi.mocked(refreshTokens).mockImplementation(async (token) => ({ ...rotated, access_token: `new-${token}` }))
    try {
      const [prod, staging] = await Promise.all([getTokens(configDir()), getTokens(stagingDir)])
      expect(prod?.access_token).toBe('new-prod-refresh')
      expect(staging?.access_token).toBe('new-stage-refresh')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // Staging shares production's Auth0 tenant, so a staging "sign-in" would be a production credential: only an API key
  // is accepted there, and a saved production login is never attached to a non-production host.
  it('refuses a saved sign-in for a non-production client and sends nothing', async () => {
    await writeAuth(JSON.stringify({ access_token: 'prod-token', expires_at: Date.now() + 3600000 }))
    vi.stubEnv('TERROS_API_KEY', '')
    vi.stubEnv('TERROS_API_ENDPOINT', '')
    vi.stubEnv('TERROS_ENV', 'prod')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    try {
      await new TerrosApiClient({ baseUrl: 'https://api.terros.com' }).get('user/profile')
      await expect(
        new TerrosApiClient({ baseUrl: 'https://api.staging.terros.com' }).get('user/profile')
      ).rejects.toThrow(/not signed in/i)
      await expect(new TerrosApiClient({ baseUrl: 'https://api.alex.terros.com' }).get('user/profile')).rejects.toThrow(
        /TERROS_API_KEY_STAGE_ALEX/
      )
      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['https://api.terros.com/user/profile'])
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('does not send a production login to an overridden staging endpoint', async () => {
    await writeAuth(JSON.stringify({ access_token: 'prod-token', expires_at: Date.now() + 3600000 }))
    vi.stubEnv('TERROS_ENV', undefined)
    vi.stubEnv('TERROS_API_KEY', '')
    vi.stubEnv('TERROS_API_ENDPOINT', 'https://api.staging.terros.com')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      await expect(new TerrosApiClient().get('user/profile')).rejects.toThrow(/not signed in/i)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  // The staging sign-in must live apart from production's, or a command would send one environment's token to the other.
  it('keeps a staging login out of the production auth file', async () => {
    await writeAuth(JSON.stringify({ access_token: 'prod-token', expires_at: Date.now() + 3600000 }))
    vi.stubEnv('TERROS_ENV', 'staging')
    await saveTokens({ ...rotated, access_token: 'staging-token' })
    expect((await getTokens())?.access_token).toBe('staging-token')
    vi.stubEnv('TERROS_ENV', undefined)
    expect((await getTokens())?.access_token).toBe('prod-token')
    expect(await readdir(join(configDir(), 'env'))).toEqual(['staging'])
  })
})
