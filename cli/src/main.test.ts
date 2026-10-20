import { parseEndpoints } from '@terros-inc/mcp-core'
import { startMcpServer } from './mcp'
import { main } from './main'
import { loadEndpoints } from './loadEndpoints'
import { authCommands } from './commands/auth'

vi.mock('./loadEndpoints', () => ({ loadEndpoints: vi.fn() }))
vi.mock('./mcp', () => ({ startMcpServer: vi.fn() }))
// The real connect commands and API client import workspace packages, which CI only builds after the tests run.
vi.mock('./commands/connect', () => ({ connectCommands: {} }))
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

afterEach(() => log.mockRestore())

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
})

describe('a built-in nothing lands on', () => {
  it('runs when the schema cannot be loaded at all', async () => {
    vi.mocked(loadEndpoints).mockRejectedValue(new Error('ENOENT: terros.yml'))
    await main(['auth', 'login'])
    expect(login).toHaveBeenCalledOnce()
  })

  it('runs when an endpoint lands on a different built-in', async () => {
    schema('/connect/publish', '/garden/bed/list')
    await main(['auth', 'login'])
    expect(login).toHaveBeenCalledOnce()
  })
})
