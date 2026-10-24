import { parseEndpoints } from '@terros-inc/mcp-core'
import { startMcpServer } from './mcp'
import { main, parseArgv } from './main'
import { loadEndpoints } from './loadEndpoints'
import { authCommands } from './commands/auth'
import { buildTerrosClient } from './api/query'

vi.mock('./loadEndpoints', () => ({ loadEndpoints: vi.fn() }))
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
const login = vi.mocked(authCommands.login.run)
let log: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetAllMocks()
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
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
