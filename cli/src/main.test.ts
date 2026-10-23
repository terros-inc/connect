import { parseEndpoints } from '@terros-inc/mcp-core'
import { startMcpServer } from './mcp'
import { main } from './main'
import { loadEndpoints, loadEndpointsAfterRefresh } from './loadEndpoints'
import { authCommands } from './commands/auth'
import { clearOpenApiCache } from './cache'
import { buildTerrosClient } from './api/query'

vi.mock('./loadEndpoints', () => ({ loadEndpoints: vi.fn(), loadEndpointsAfterRefresh: vi.fn() }))
vi.mock('./cache', () => ({ clearOpenApiCache: vi.fn(), clearRuntimeCaches: vi.fn() }))
vi.mock('./api/query', () => ({ buildTerrosClient: vi.fn() }))
vi.mock('./mcp', () => ({ startMcpServer: vi.fn() }))
// The real connect commands and API client import workspace packages, which CI only builds after the tests run.
vi.mock('./commands/connect', () => ({
  connectCommands: { publish: { description: 'Publish an integration', run: vi.fn() } },
}))
vi.mock('./api/query', () => ({ buildTerrosClient: vi.fn() }))
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
    internalSchemaStatus: 'available',
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
})

afterEach(() => {
  log.mockRestore()
  process.exitCode = undefined
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
    expect(startMcpServer).not.toHaveBeenCalled()
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
    internalSchemaStatus: 'available',
  })

  await main(['garden', 'bed', 'list', '--newFilter', 'active'])

  expect(call).toHaveBeenCalledWith('/garden/bed/list', { newFilter: 'active' })
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(process.exitCode).toBeUndefined()
})

it('does not execute an unknown command when the internal schema is unavailable', async () => {
  schema('/company/list')
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({
    endpoints: parseEndpoints(spec('/company/list')),
    internalSchemaStatus: 'unavailable',
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

it('lets api refresh recover from a stale endpoint collision', async () => {
  schema('/api/refresh')
  refreshedSchema('/api/refresh')

  await main(['api', 'refresh'])

  expect(loadEndpointsAfterRefresh).toHaveBeenCalledOnce()
  expect(clearOpenApiCache).toHaveBeenCalledOnce()
})
