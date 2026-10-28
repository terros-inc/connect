import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { TokenResponse } from './types.ts'
import { refreshTokens } from './auth0.ts'
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
vi.mock('./auth0.ts', () => ({ refreshTokens: vi.fn() }))

const rotated: TokenResponse = {
  access_token: 'new-token',
  refresh_token: 'rotated-refresh-token',
  id_token: undefined,
  token_type: 'Bearer',
  expires_in: 3600,
}
const expired = JSON.stringify({ access_token: 'old-token', refresh_token: 'refresh-token-example', expires_at: 0 })

const configDir = () => join(home.dir, '.config', 'terros')
const authFile = () => join(configDir(), 'auth.json')
const lockFile = () => `${authFile()}.lock`
const writeAuth = async (content: string) => {
  await mkdir(configDir(), { recursive: true })
  await writeFile(authFile(), content)
}
const readAuth = async () => JSON.parse(await readFile(authFile(), 'utf-8'))

beforeEach(async () => {
  vi.mocked(refreshTokens).mockReset()
  home.dir = await mkdtemp(join(tmpdir(), 'terros-tokens-'))
})

afterEach(async () => {
  await rm(home.dir, { recursive: true, force: true })
})

describe('getTokens', () => {
  it('returns null when no saved login exists', async () => {
    expect(await getTokens()).toBeNull()
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('returns null when the saved login is not valid JSON', async () => {
    await writeAuth('{')
    expect(await getTokens()).toBeNull()
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it.each([-1, 4])('refreshes a token expiring in %i minutes', async (minutes) => {
    await writeAuth(
      JSON.stringify({
        access_token: 'old-token',
        refresh_token: 'refresh-token-example',
        expires_at: Date.now() + minutes * 60000,
      })
    )
    vi.mocked(refreshTokens).mockResolvedValue(rotated)
    expect((await getTokens())?.access_token).toBe('new-token')
    expect(refreshTokens).toHaveBeenCalledWith('refresh-token-example')
    expect(await readAuth()).toMatchObject({ access_token: 'new-token', refresh_token: 'rotated-refresh-token' })
  })

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

  it('waits for another process holding the refresh lock and uses the tokens it saved', async () => {
    await writeAuth(expired)
    await writeFile(lockFile(), String(process.pid))
    const tokens = getTokens()
    await sleep(200)
    expect(refreshTokens).not.toHaveBeenCalled()
    await writeAuth(
      JSON.stringify({ ...rotated, access_token: 'other-process-token', expires_at: Date.now() + 3600000 })
    )
    await rm(lockFile())
    expect((await tokens)?.access_token).toBe('other-process-token')
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  // Taking over a live process's lock could send the token it is refreshing with a second time.
  it('gives up instead of refreshing while another running process holds the lock', async () => {
    await writeAuth(expired)
    await writeFile(lockFile(), `${process.pid}:other-process`)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const tokens = getTokens()
      await sleep(200)
      vi.setSystemTime(Date.now() + 2 * 60000)
      await expect(tokens).rejects.toThrow('Timed out waiting')
    } finally {
      vi.useRealTimers()
    }
    expect(refreshTokens).not.toHaveBeenCalled()
    expect(await readFile(lockFile(), 'utf-8')).toBe(`${process.pid}:other-process`)
  })

  // A process killed mid-refresh must not leave every later command waiting on its lock.
  it('takes over a lock left by a process that is no longer running', async () => {
    await writeAuth(expired)
    await writeFile(lockFile(), '999999999')
    vi.mocked(refreshTokens).mockResolvedValue(rotated)
    expect((await getTokens())?.access_token).toBe('new-token')
    await expect(stat(lockFile())).rejects.toThrow()
  })

  it('keeps the saved refresh token when the refresh response has none', async () => {
    await writeAuth(expired)
    vi.mocked(refreshTokens).mockResolvedValue({ ...rotated, refresh_token: undefined })
    expect((await getTokens())?.refresh_token).toBe('refresh-token-example')
    expect(await readAuth()).toMatchObject({ access_token: 'new-token', refresh_token: 'refresh-token-example' })
  })

  it('reuses tokens that remain valid beyond the refresh window', async () => {
    await writeAuth(JSON.stringify({ access_token: 'valid-token', expires_at: Date.now() + 3600000 }))
    expect((await getTokens())?.access_token).toBe('valid-token')
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('propagates refresh failures without overwriting the saved login or keeping the lock', async () => {
    await writeAuth(expired)
    vi.mocked(refreshTokens).mockRejectedValue(new Error('Unable to refresh token'))
    await expect(getTokens()).rejects.toThrow('Unable to refresh token')
    expect(await readFile(authFile(), 'utf-8')).toBe(expired)
    await expect(stat(lockFile())).rejects.toThrow()
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
})
