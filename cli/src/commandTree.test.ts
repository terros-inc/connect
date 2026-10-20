import { parseEndpoints } from '@terros-inc/mcp-core'
import { buildCliCommandTree, findBuiltin, formatBuiltinHelp, matchCommand } from './commandTree'
import type { CommandRegistry } from './commands/types'
import { apiLogParameters } from './commands/apiLogParams'

const run = vi.fn()
// Mirrors the shape of the real built-ins without loading their modules.
const registry: CommandRegistry = {
  api: { description: 'api', subcommands: { log: { description: 'log', run } } },
  auth: {
    description: 'auth',
    subcommands: { login: { description: 'login', run }, token: { description: 'token', run } },
  },
  connect: {
    description: 'connect',
    subcommands: { pack: { description: 'pack', run }, publish: { description: 'publish', run } },
  },
  mcp: { description: 'mcp', run, subcommands: {} },
}

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

const tree = buildCliCommandTree(
  parseEndpoints(spec('/search', '/bed/list', '/garden/bed/list', '/garden/bed/tag/add', '/connect/greenhouse/get')),
  registry
)

describe('matchCommand', () => {
  it('matches a command of three or more words', () => {
    const level = matchCommand(tree, registry, ['garden', 'bed', 'tag', 'add'])
    expect(level).toMatchObject({ words: ['garden', 'bed', 'tag', 'add'], unmatched: [], subcommands: [] })
    expect(level.node.endpoint?.path).toBe('/garden/bed/tag/add')
  })

  it('matches a single-segment endpoint', () => {
    expect(matchCommand(tree, registry, ['search']).node.endpoint?.path).toBe('/search')
  })

  it('lists nested subcommands at each level', () => {
    expect(matchCommand(tree, registry, ['garden']).subcommands).toEqual(['bed'])
    expect(matchCommand(tree, registry, ['garden', 'bed']).subcommands).toEqual(['list', 'tag'])
    expect(matchCommand(tree, registry, ['garden', 'bed', 'tag']).subcommands).toEqual(['add'])
  })

  it('lists built-in and endpoint commands together at the top level', () => {
    expect(matchCommand(tree, registry, []).subcommands).toEqual([
      'api',
      'auth',
      'bed',
      'connect',
      'garden',
      'mcp',
      'search',
    ])
  })

  it('lists built-in subcommands next to endpoints under the same word', () => {
    expect(matchCommand(tree, registry, ['connect']).subcommands).toEqual(['greenhouse', 'pack', 'publish'])
    expect(matchCommand(tree, registry, ['connect', 'greenhouse', 'get']).node.endpoint?.path).toBe(
      '/connect/greenhouse/get'
    )
  })

  it('treats a built-in group without endpoints as a level', () => {
    expect(matchCommand(tree, registry, ['auth'])).toMatchObject({
      words: ['auth'],
      unmatched: [],
      subcommands: ['login', 'token'],
    })
  })

  it('reports unknown words, including old last-two-segment names', () => {
    expect(matchCommand(tree, registry, ['bed', 'tag', 'add'])).toMatchObject({
      words: ['bed'],
      unmatched: ['tag', 'add'],
    })
    expect(matchCommand(tree, registry, ['toString'])).toMatchObject({ words: [], unmatched: ['toString'] })
  })
})

describe('findBuiltin', () => {
  it('finds built-in subcommands and passes the remaining words as args', () => {
    expect(findBuiltin(registry, ['connect', 'publish', 'extra'])).toMatchObject({ args: ['extra'] })
    expect(findBuiltin(registry, ['mcp'])).toMatchObject({ args: [] })
  })

  it('leaves other words to the endpoint tree', () => {
    expect(findBuiltin(registry, ['connect'])).toBeUndefined()
    expect(findBuiltin(registry, ['connect', 'greenhouse', 'get'])).toBeUndefined()
    expect(findBuiltin(registry, ['garden', 'bed', 'list'])).toBeUndefined()
    expect(findBuiltin(registry, ['toString'])).toBeUndefined()
    expect(findBuiltin(registry, ['auth', 'constructor'])).toBeUndefined()
  })
})

describe('buildCliCommandTree', () => {
  it('fails when an endpoint lands on a built-in subcommand, naming both', () => {
    expect(() => buildCliCommandTree(parseEndpoints(spec('/connect/publish/add')), registry)).toThrow(
      'Endpoint /connect/publish/add collides with the built-in command: terros connect publish'
    )
  })

  it('fails when an endpoint lands on a built-in command, naming both', () => {
    expect(() => buildCliCommandTree(parseEndpoints(spec('/auth')), registry)).toThrow(
      'Endpoint /auth collides with the built-in command: terros auth'
    )
  })
})

describe('formatBuiltinHelp', () => {
  const helpRegistry: CommandRegistry = {
    api: {
      description: 'api',
      subcommands: { log: { description: 'List API requests.', parameters: apiLogParameters, run } },
    },
  }

  it('lists the flags a built-in declares instead of "none"', () => {
    expect(formatBuiltinHelp(helpRegistry, ['api', 'log'])).toContain('--companyId')
  })

  it('leaves groups without their own command and endpoint words to the endpoint tree', () => {
    expect(formatBuiltinHelp(helpRegistry, ['api'])).toBeUndefined()
    expect(formatBuiltinHelp(helpRegistry, ['api', 'history'])).toBeUndefined()
    expect(formatBuiltinHelp(helpRegistry, ['entitlement', 'add'])).toBeUndefined()
  })
})
