import { parseEndpoints } from '@terros-inc/mcp-core'
import { startMcpServer } from './mcp'
import { main } from './main'
import { loadEndpoints } from './loadEndpoints'
import { ratioEndpoints } from './crud/ratio'
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
const ratioSchema = () => vi.mocked(loadEndpoints).mockResolvedValue({ ratio: ratioEndpoints })
const login = vi.mocked(authCommands.login.run)
const call = vi.fn()
let log: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(buildTerrosClient).mockReturnValue({ call } as unknown as ReturnType<typeof buildTerrosClient>)
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

describe('custom stat read commands', () => {
  const modifiedBy = [{ userId: 'U.example', timestamp: 1_800_000_000_000, updateProcess: 'settings' }]
  const ratio = {
    ratioId: 'Ratio.example',
    scopeId: 'C.example',
    name: 'Conversion rate',
    type: 'percentage',
    numerator: 'contact.pitches',
    denominator: 'contact.knocks',
    modifiedBy,
  }
  const formula = {
    ratioId: 'Ratio.sample',
    scopeId: 'C.example',
    name: 'Weighted outcome',
    type: 'formula',
    formula: '$wins * 2 + $sits',
    scopes: { $wins: 'event.sales', $sits: 'event.sits' },
    formatter: 'round',
    accumulator: 'sum',
    modifiedBy,
  }

  it('lists ratio and advanced custom stats without dropping their definitions or history', async () => {
    ratioSchema()
    const response = { type: 'success', ratios: [ratio, formula] }
    call.mockResolvedValue(response)

    await main(['ratio', 'list', '--scopeId', 'C.example'])

    expect(call).toHaveBeenCalledWith('/ratio/list', { scopeId: 'C.example' })
    expect(log).toHaveBeenCalledWith(JSON.stringify(response, null, 2))
  })

  it.each([ratio, formula])('gets the full $type custom stat definition and history', async (stat) => {
    ratioSchema()
    const response = { type: 'success', ratio: stat }
    call.mockResolvedValue(response)

    await main(['ratio', 'get', '--ratioId', stat.ratioId])

    expect(call).toHaveBeenCalledWith('/ratio/get', { ratioId: stat.ratioId })
    expect(log).toHaveBeenCalledWith(JSON.stringify(response, null, 2))
  })
})

describe('custom stat write commands', () => {
  it('adds an advanced custom stat without an explicit scope using the API ratio contract', async () => {
    ratioSchema()
    call.mockResolvedValue({ type: 'success' })
    const ratio = {
      name: 'Revenue per pitch',
      type: 'formula',
      formula: '$Revenue / $Pitch',
      scopes: {
        $Revenue: 'cf|account|sum|CF.revenue|createdDate',
        $Pitch: 'contact.pitches',
      },
    }

    await main(['ratio', 'add', '--ratio', JSON.stringify(ratio)])

    expect(call).toHaveBeenCalledWith('/ratio/add', { ratio })
  })
})
