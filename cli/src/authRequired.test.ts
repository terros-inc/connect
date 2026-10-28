import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'

// Runs the real CLI with only the network and home directory faked, so a schema load and the command itself both reach
// the shared token code, as `terros whoami` does with a dead saved session.
const home = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.path,
}))

let auth0: Response
const fetchMock = vi.fn(async (url: string | URL) => {
  const { hostname } = new URL(url)
  if (hostname === 'auth.terros.com') return auth0.clone()
  if (hostname === 'docs.terros.com') return new Response('', { status: 503 })
  throw new Error(`Unexpected request to ${url}`)
})
const auth0Calls = () => fetchMock.mock.calls.filter(([url]) => new URL(url).hostname === 'auth.terros.com')
const apiCalls = () => fetchMock.mock.calls.filter(([url]) => new URL(url).hostname === 'api.terros.com')

async function saveExpiredLogin(): Promise<void> {
  const directory = join(home.path, '.config', 'terros')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'auth.json'),
    JSON.stringify({ access_token: 'access-token-example', refresh_token: 'refresh-token-example', expires_at: 0 })
  )
}

async function run(...argv: string[]): Promise<{ stderr: string[]; stdout: string }> {
  // A fresh module graph per run, as each `terros` process starts without a remembered refresh failure.
  vi.resetModules()
  const { runCli } = await import('./main')
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  await runCli(argv)
  return {
    stderr: stderr.mock.calls.map((args) => args.map(String).join(' ')),
    stdout: [...log.mock.calls, ...write.mock.calls].map((args) => String(args[0])).join(''),
  }
}

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TERROS_API_KEY', '')
  vi.stubEnv('TERROS_API_ENDPOINT', '')
  vi.stubEnv('TERROS_IMPERSONATE', '')
  vi.stubEnv('TERROS_DEBUG', '')
  home.path = await mkdtemp(join(tmpdir(), 'terros-auth-'))
  auth0 = Response.json(
    { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' },
    { status: 403 }
  )
})

afterEach(async () => {
  await rm(home.path, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockClear()
  process.exitCode = undefined
})

// Guards against the internal-schema load printing its warning, the API client wrapping the error so its stack is
// printed, `auth token` exiting 0, and the command refreshing the dead token a second time after the schema load did.
describe.each([['whoami'], ['auth', 'token']])('terros %s', (...command) => {
  it('prints one line and exits 1 when the saved session has expired', async () => {
    await saveExpiredLogin()
    const { stderr, stdout } = await run(...command)
    expect(stderr).toEqual(['Your Terros session has expired. Run `terros auth login` to sign in again.'])
    expect(stdout).toBe('')
    expect(process.exitCode).toBe(1)
    expect(auth0Calls()).toHaveLength(1)
    expect(apiCalls()).toHaveLength(0)
  })

  it('prints one line and exits 1 when nobody is signed in', async () => {
    const { stderr, stdout } = await run(...command)
    expect(stderr).toEqual(["You're not signed in to Terros. Run `terros auth login` to sign in."])
    expect(stdout).toBe('')
    expect(process.exitCode).toBe(1)
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).hostname !== 'docs.terros.com')).toHaveLength(0)
  })
})

// Guards against every Auth0 failure telling the user to sign in again, which does not help during an Auth0 outage.
it('keeps a sign-in outage generic and to one line', async () => {
  await saveExpiredLogin()
  auth0 = Response.json({ error: 'server_error' }, { status: 500 })
  const { stderr } = await run('auth', 'token')
  expect(stderr.at(-1)).toBe('Unable to refresh the Terros session: sign-in answered 500 server_error')
  expect(stderr.join('\n')).not.toMatch(/session has expired|\n\s+at /)
  expect(process.exitCode).toBe(1)
})

it('lists commands without a schema warning when the saved session has expired', async () => {
  await saveExpiredLogin()
  const { stderr, stdout } = await run('help')
  expect(stderr).toEqual([])
  expect(stdout).toContain('whoami')
  expect(process.exitCode).toBeUndefined()
})
