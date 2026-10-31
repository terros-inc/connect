import { parseEndpoints } from '@terros-inc/mcp-core'
import { TerrosApiError } from '@terros-inc/connect-common'
import { main, parseArgv } from './main'
import { loadEndpoints, loadEndpointsAfterRefresh } from './loadEndpoints'
import { loadInternalSchemaWithStatus } from './crud/internal'
import { authCommands } from './commands/auth'
import { clearOpenApiCache } from './cache'
import { buildTerrosClient } from './api/query'

vi.mock('./loadEndpoints', () => ({ loadEndpoints: vi.fn(), loadEndpointsAfterRefresh: vi.fn() }))
vi.mock('./cache', () => ({ clearOpenApiCache: vi.fn(), clearRuntimeCaches: vi.fn() }))
vi.mock('./api/query', () => ({ buildTerrosClient: vi.fn() }))
vi.mock('./crud/internal', () => ({ loadInternalSchemaWithStatus: vi.fn() }))
// The real connect commands and API client import workspace packages, which CI only builds after the tests run.
vi.mock('./commands/connect', () => ({
  connectCommands: { publish: { description: 'Publish an integration', run: vi.fn() } },
}))
vi.mock('./commands/auth', () => ({
  authCommands: { login: { description: 'Sign in to Terros', run: vi.fn() } },
}))

const spec = (...paths: string[]): string =>
  JSON.stringify({
    openapi: '3.1.1',
    paths: Object.fromEntries(
      paths.map((path) => [
        path,
        { post: { summary: path, requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } },
      ])
    ),
    components: { schemas: {} },
  })

const schema = (...paths: string[]) =>
  vi.mocked(loadEndpoints).mockImplementation(async () => parseEndpoints(spec(...paths)))
const refreshedSchema = (...paths: string[]) =>
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({
    endpoints: parseEndpoints(spec(...paths)),
    schemaStatus: 'available',
  })
const schemaWithParameter = (path: string, parameter: string) => {
  const document = JSON.parse(spec(path))
  document.paths[path].post.requestBody.content['application/json'].schema.properties = {
    [parameter]: { type: 'string' },
  }
  return JSON.stringify(document)
}
const login = vi.mocked(authCommands.login.run)
const call = vi.fn()
let log: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetAllMocks()
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  call.mockResolvedValue({ ok: true })
  vi.mocked(buildTerrosClient).mockReturnValue({ call } as unknown as ReturnType<typeof buildTerrosClient>)
  vi.mocked(loadInternalSchemaWithStatus).mockResolvedValue({ status: 'unavailable' })
  vi.stubEnv('TERROS_IMPERSONATE', '')
})

afterEach(() => {
  log.mockRestore()
  process.exitCode = undefined
  vi.unstubAllEnvs()
})

// Built-ins dispatch before endpoint commands, so each case goes through main to prove the built-in never runs.
describe('a built-in an endpoint path lands on', () => {
  it('fails instead of running, naming the endpoint', async () => {
    schema('/auth/login')
    await expect(main(['auth', 'login'])).rejects.toThrow(
      'Endpoint /auth/login collides with the built-in command: terros auth login'
    )
    expect(login).not.toHaveBeenCalled()
  })

  it('fails instead of showing its help', async () => {
    schema('/auth/login')
    await expect(main(['auth', 'login', 'help'])).rejects.toThrow('collides with the built-in command')
    expect(log).not.toHaveBeenCalled()
  })

  it('fails when the colliding paths are rejected by the parser before the tree is built', async () => {
    schema('/mcp', '/mcp/')
    await expect(main(['mcp'])).rejects.toThrow('Endpoints /mcp and /mcp/ both map to the command: terros mcp')
    await expect(main(['mcp', 'help'])).rejects.toThrow('both map to the command: terros mcp')
    expect(log).not.toHaveBeenCalled()
  })

  // Group help and unknown group words load the whole tree; a collision there must not fall back to an empty tree.
  it.each([
    ['/connect/publish', 'connect help'],
    ['/auth/login', 'auth help'],
    ['/auth/login', 'auth nope'],
    ['/connect/publish', 'connect'],
  ])('with %s, fails `terros %s`', async (path, command) => {
    schema(path)
    await expect(main(command.split(' '))).rejects.toThrow(`Endpoint ${path} collides with the built-in command`)
    expect(log).not.toHaveBeenCalled()
  })

  it('fails group help when two endpoints collide', async () => {
    schema('/garden/bed/list', '/garden/bed/list/')
    await expect(main(['auth', 'help'])).rejects.toThrow('both map to the command: terros garden bed list')
    expect(log).not.toHaveBeenCalled()
  })
})

describe('a built-in nothing lands on', () => {
  it('runs when the schema cannot be loaded at all', async () => {
    vi.mocked(loadEndpoints).mockRejectedValue(new Error('ENOENT: terros.yml'))
    await main(['auth', 'login'])
    expect(login).toHaveBeenCalledOnce()
  })

  it('lists its group help when the schema cannot be loaded at all', async () => {
    vi.mocked(loadEndpoints).mockRejectedValue(new Error('ENOENT: terros.yml'))
    await main(['auth', 'help'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('login'))
    expect(process.exitCode).toBeUndefined()
  })

  it('runs when an endpoint lands on a different built-in', async () => {
    schema('/connect/publish', '/garden/bed/list')
    await main(['auth', 'login'])
    expect(login).toHaveBeenCalledOnce()
  })

  // An AI client configured with the removed local server still starts `terros mcp` and reads stdout as its protocol
  // stream, so it must fail with the migration message (stderr, via index.ts) and print nothing to stdout.
  it('fails `terros mcp` with the hosted MCP address and nothing on stdout', async () => {
    schema('/garden/bed/list')
    await expect(main(['mcp'])).rejects.toThrow('https://mcp.terros.com/mcp')
    expect(log).not.toHaveBeenCalled()
  })
})

describe('an endpoint command', () => {
  // Staff with company:update get presigned write URLs from company/get; printing them would hand out upload access.
  it('prints the response without presigned upload URLs', async () => {
    schema('/company/get')
    const call = vi.fn().mockResolvedValue({
      company: {
        companyId: 'C.example',
        name: 'Acme Solar',
        uploadAvatarUrl: 'https://s3.example.test/a',
        uploadIconUrl: 'https://s3.example.test/i',
      },
    })
    vi.mocked(buildTerrosClient).mockReturnValue({ call } as unknown as ReturnType<typeof buildTerrosClient>)
    await main(['company', 'get'])
    expect(call).toHaveBeenCalledWith('/company/get', expect.anything())
    expect(log).toHaveBeenCalledOnce()
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      company: { companyId: 'C.example', name: 'Acme Solar' },
    })
  })
})

// minimist alone reads `--longitude -124.5` as the short flags -1, -2 and -4, so a map query failed as unknown flags.
describe('parseArgv', () => {
  it.each([
    ['-124.5', -124.5],
    ['-3', -3],
    ['-.5', -0.5],
    ['-1e-3', -0.001],
  ])('reads %s after a long flag as its value', (value, expected) => {
    expect(parseArgv(['area', 'list', '--boundingBox.top.longitude', value, '--limit', '5'])).toEqual({
      _: ['area', 'list'],
      boundingBox: { top: { longitude: expected } },
      limit: 5,
    })
  })

  it('leaves `--flag=value`, short flags and words after `--` as minimist reads them', () => {
    expect(parseArgv(['--a=-1', '-2', '-v', '-3', '--', '--b', '-4'])).toEqual({
      _: ['--b', '-4'],
      a: -1,
      2: true,
      v: true,
      3: true,
    })
  })
})

it('reports that an endpoint is absent after a successful schema refresh', async () => {
  schema('/company/list')
  refreshedSchema('/company/list')

  await main(['company', 'missing'])

  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(process.exitCode).toBe(1)
})

it('retries a newly available endpoint once after refreshing the schema', async () => {
  schema('/company/list')
  refreshedSchema('/company/list', '/garden/bed/list')

  await main(['garden', 'bed', 'list'])

  expect(call).toHaveBeenCalledWith('/garden/bed/list', {})
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(process.exitCode).toBeUndefined()
})

it('refreshes and retries when an endpoint gains a parameter', async () => {
  schema('/garden/bed/list')
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({
    endpoints: parseEndpoints(schemaWithParameter('/garden/bed/list', 'newFilter')),
    schemaStatus: 'available',
  })

  await main(['garden', 'bed', 'list', '--newFilter', 'active'])

  expect(call).toHaveBeenCalledWith('/garden/bed/list', { newFilter: 'active' })
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(process.exitCode).toBeUndefined()
})

it('reports an unsupported parameter after discovering an endpoint without refreshing twice', async () => {
  schema('/company/list')
  refreshedSchema('/company/list', '/garden/bed/list')

  await main(['garden', 'bed', 'list', '--unsupported', 'active'])

  expect(loadEndpointsAfterRefresh).toHaveBeenCalledOnce()
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(call).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(1)
})

it('does not execute an unknown command when the schema could not be refreshed', async () => {
  schema('/company/list')
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({
    endpoints: parseEndpoints(spec('/company/list')),
    schemaStatus: 'failed',
  })
  await main(['company', 'missing'])

  expect(loadEndpointsAfterRefresh).toHaveBeenCalledOnce()
  expect(call).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(1)
})

it('does not refresh the schema for a typo in a built-in subcommand', async () => {
  schema('/company/list')

  await main(['auth', 'logn'])

  expect(clearOpenApiCache).not.toHaveBeenCalled()
})

it('does not refresh for a likely typo in a built-in subcommand', async () => {
  schema('/company/list')

  await main(['api', 'refesh'])

  expect(clearOpenApiCache).not.toHaveBeenCalled()
  expect(loadEndpointsAfterRefresh).not.toHaveBeenCalled()
})

it('refreshes for a new API endpoint under a built-in group', async () => {
  schema('/company/list')
  refreshedSchema('/company/list', '/api/foo')

  await main(['api', 'foo'])

  expect(call).toHaveBeenCalledWith('/api/foo', {})
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
})

it('refreshes a missing command in a known API subtree even when its name resembles a built-in', async () => {
  schema('/api/logs/list')
  refreshedSchema('/api/logs/list', '/api/logs/get')

  await main(['api', 'logs', 'get'])

  expect(call).toHaveBeenCalledWith('/api/logs/get', {})
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(process.exitCode).toBeUndefined()
})

it('lets api refresh recover from a stale endpoint collision', async () => {
  schema('/api/refresh')
  refreshedSchema('/api/refresh')

  await main(['api', 'refresh'])

  expect(loadEndpointsAfterRefresh).toHaveBeenCalledOnce()
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
})

describe('acting as a customer', () => {
  let stderr: ReturnType<typeof vi.spyOn>
  const errorOutput = (): string => stderr.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
  const asStaff = (): unknown => vi.mocked(loadInternalSchemaWithStatus).mockResolvedValue({ status: 'available' })
  const notFound = new TerrosApiError({ type: 'error', error: 'NotFound', message: 'Area not found' })

  beforeEach(() => {
    stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => stderr.mockRestore())

  // A guessed impersonation flag can never become valid, so sending the caller to `api refresh` only hides the fix.
  it.each(['impersonate', 'as', 'asUser', 'user', 'companyId'])(
    'answers --%s with TERROS_IMPERSONATE instead of a schema refresh',
    async (flag) => {
      vi.mocked(loadEndpoints).mockImplementation(async () =>
        parseEndpoints(schemaWithParameter('/account/get', 'accountId'))
      )

      await main(['account', 'get', '--accountId', 'Account.example', `--${flag}`, 'C.example'])

      expect(errorOutput()).toContain('TERROS_IMPERSONATE=<userId>')
      expect(errorOutput()).not.toContain('api refresh')
      expect(loadEndpointsAfterRefresh).not.toHaveBeenCalled()
      expect(call).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    }
  )

  // A staff caller read another company's NotFound as "the record does not exist".
  it.each([
    ['NotFound', 'Area not found'],
    ['NotAuthorized', 'You do not have permission to view this account.'],
    ['InvalidRequest', 'Unauthorized workflow IDs: WF.example'],
  ])('tells staff acting as themselves that a %s may be another company', async (code, message) => {
    asStaff()
    schema('/area/get')
    call.mockRejectedValue(new TerrosApiError({ type: 'error', error: code, message }))

    await main(['area', 'get'])

    expect(errorOutput()).toContain(`${code}: ${message}`)
    expect(errorOutput()).toContain('TERROS_IMPERSONATE=<userId>')
    expect(log).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('leaves stdout JSON unchanged when it hints at an empty list', async () => {
    asStaff()
    schema('/area/list')
    call.mockResolvedValue({ type: 'success', areas: [], total: 0 })

    await main(['area', 'list'])

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({ type: 'success', areas: [], total: 0 })
    expect(errorOutput()).toContain('TERROS_IMPERSONATE=<userId>')
  })

  // An impersonating or customer caller already reads the right company; a hint would send them chasing nothing.
  it.each([
    ['impersonating', 'available', 'U.example'],
    ['not staff', 'unavailable', ''],
  ])('prints no hint while %s', async (_, status, impersonate) => {
    vi.mocked(loadInternalSchemaWithStatus).mockResolvedValue({ status: status as 'available' | 'unavailable' })
    vi.stubEnv('TERROS_IMPERSONATE', impersonate)
    schema('/area/get', '/area/list')

    call.mockRejectedValue(notFound)
    await expect(main(['area', 'get'])).rejects.toBe(notFound)
    call.mockResolvedValue({ type: 'success', areas: [], total: 0 })
    await main(['area', 'list'])

    expect(stderr).not.toHaveBeenCalled()
  })

  // A match or a validation error is a real answer, not a company-scope miss.
  it.each([
    ['a matched record', { type: 'success', account: { accountId: 'Account.example' }, additionalMatches: [] }],
    ['a non-empty list', { type: 'success', areas: [{ areaId: 'Area.example' }], total: 1 }],
  ])('prints no hint for %s', async (_, response) => {
    asStaff()
    schema('/area/list')
    call.mockResolvedValue(response)

    await main(['area', 'list'])

    expect(stderr).not.toHaveBeenCalled()
  })

  it('rethrows an unrelated failure without a hint', async () => {
    asStaff()
    schema('/area/get')
    const invalid = new TerrosApiError({ type: 'error', error: 'InvalidRequest', message: 'areaId is required' })
    call.mockRejectedValue(invalid)

    await expect(main(['area', 'get'])).rejects.toBe(invalid)
    expect(stderr).not.toHaveBeenCalled()
  })

  it.each([['help'], ['whoami', 'help']])('names TERROS_IMPERSONATE in `terros %s`', async (...words) => {
    schema('/area/get')
    await main(words)
    expect(log.mock.calls.join('\n')).toContain('TERROS_IMPERSONATE=<userId>')
  })
})
