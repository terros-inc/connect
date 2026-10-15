import { parseEndpoints } from '@terros-inc/mcp-core'
import { buildCliCommandTree, findBuiltin, matchCommand } from './commandTree'

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
  parseEndpoints(spec('/search', '/bed/list', '/garden/bed/list', '/garden/bed/tag/add', '/connect/greenhouse/get'))
)

describe('matchCommand', () => {
  it('matches a command of three or more words', () => {
    const level = matchCommand(tree, ['garden', 'bed', 'tag', 'add'])
    expect(level).toMatchObject({ words: ['garden', 'bed', 'tag', 'add'], unmatched: [], subcommands: [] })
    expect(level.node.endpoint?.path).toBe('/garden/bed/tag/add')
  })

  it('matches a single-segment endpoint', () => {
    expect(matchCommand(tree, ['search']).node.endpoint?.path).toBe('/search')
  })

  it('lists nested subcommands at each level', () => {
    expect(matchCommand(tree, ['garden']).subcommands).toEqual(['bed'])
    expect(matchCommand(tree, ['garden', 'bed']).subcommands).toEqual(['list', 'tag'])
    expect(matchCommand(tree, ['garden', 'bed', 'tag']).subcommands).toEqual(['add'])
  })

  it('lists built-in and endpoint commands together at the top level', () => {
    expect(matchCommand(tree, []).subcommands).toEqual(['api', 'auth', 'bed', 'connect', 'garden', 'mcp', 'search'])
  })

  it('lists built-in subcommands next to endpoints under the same word', () => {
    expect(matchCommand(tree, ['connect']).subcommands).toEqual(['greenhouse', 'pack', 'publish'])
    expect(matchCommand(tree, ['connect', 'greenhouse', 'get']).node.endpoint?.path).toBe('/connect/greenhouse/get')
  })

  it('treats a built-in group without endpoints as a level', () => {
    expect(matchCommand(tree, ['auth'])).toMatchObject({
      words: ['auth'],
      unmatched: [],
      subcommands: ['login', 'token'],
    })
  })

  it('reports unknown words, including old last-two-segment names', () => {
    expect(matchCommand(tree, ['bed', 'tag', 'add'])).toMatchObject({ words: ['bed'], unmatched: ['tag', 'add'] })
    expect(matchCommand(tree, ['toString'])).toMatchObject({ words: [], unmatched: ['toString'] })
  })
})

describe('findBuiltin', () => {
  it('finds built-in subcommands and passes the remaining words as args', () => {
    expect(findBuiltin(['connect', 'publish', 'extra'])).toMatchObject({ args: ['extra'] })
    expect(findBuiltin(['mcp'])).toMatchObject({ args: [] })
  })

  it('leaves other words to the endpoint tree', () => {
    expect(findBuiltin(['connect'])).toBeUndefined()
    expect(findBuiltin(['connect', 'greenhouse', 'get'])).toBeUndefined()
    expect(findBuiltin(['garden', 'bed', 'list'])).toBeUndefined()
    expect(findBuiltin(['toString'])).toBeUndefined()
    expect(findBuiltin(['auth', 'constructor'])).toBeUndefined()
  })
})

describe('buildCliCommandTree', () => {
  it('fails when an endpoint lands on a built-in subcommand, naming both', () => {
    expect(() => buildCliCommandTree(parseEndpoints(spec('/connect/publish/add')))).toThrow(
      'Endpoint /connect/publish/add collides with the built-in command: terros connect publish'
    )
  })

  it('fails when an endpoint lands on a built-in command, naming both', () => {
    expect(() => buildCliCommandTree(parseEndpoints(spec('/auth')))).toThrow(
      'Endpoint /auth collides with the built-in command: terros auth'
    )
  })
})
