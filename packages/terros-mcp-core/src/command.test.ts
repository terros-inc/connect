import { parseEndpoints } from './parser.ts'
import type { Endpoint, EndpointGroups } from './endpoint.ts'
import { buildCommandTree, findCommand, getChildCommandNames, getEndpointPaths } from './command.ts'

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

const endpoint = (path: string): Endpoint => ({ path, properties: { type: 'object' }, components: { schemas: {} } })

const tree = buildCommandTree(
  parseEndpoints(
    spec('/search', '/bed/list', '/garden/bed/list', '/garden/bed/get', '/garden/bed/tag/add', '/orchard/tree/list')
  )
)

it('follows the full path at any depth', () => {
  expect(findCommand(tree, ['garden', 'bed', 'tag', 'add']).node.endpoint?.path).toBe('/garden/bed/tag/add')
  expect(findCommand(tree, ['garden', 'bed', 'list']).node.endpoint?.path).toBe('/garden/bed/list')
  expect(findCommand(tree, ['orchard', 'tree', 'list']).node.endpoint?.path).toBe('/orchard/tree/list')
})

it('keeps a top-level group separate from a nested group with the same name', () => {
  expect(findCommand(tree, ['bed', 'list']).node.endpoint?.path).toBe('/bed/list')
  expect(findCommand(tree, ['tree', 'list']).words).toEqual([])
})

it('runs a single-segment path as a one-word command', () => {
  expect(findCommand(tree, ['search'])).toMatchObject({ words: ['search'], unmatched: [] })
  expect(findCommand(tree, ['search']).node.endpoint?.path).toBe('/search')
})

it('reports the words it could not match', () => {
  expect(findCommand(tree, ['garden', 'bed', 'water'])).toMatchObject({
    words: ['garden', 'bed'],
    unmatched: ['water'],
  })
})

it('lists the commands at every level', () => {
  expect(getChildCommandNames(tree)).toEqual(['bed', 'garden', 'orchard', 'search'])
  expect(getChildCommandNames(findCommand(tree, ['garden']).node)).toEqual(['bed'])
  expect(getChildCommandNames(findCommand(tree, ['garden', 'bed']).node)).toEqual(['get', 'list', 'tag'])
  expect(getChildCommandNames(findCommand(tree, ['garden', 'bed', 'tag']).node)).toEqual(['add'])
})

it('lists the endpoint paths below a node', () => {
  expect(getEndpointPaths(findCommand(tree, ['garden']).node)).toEqual([
    '/garden/bed/get',
    '/garden/bed/list',
    '/garden/bed/tag/add',
  ])
})

it('fails when hand-built groups map two paths to the same command, naming both paths', () => {
  const groups: EndpointGroups = {
    garden: { 'bed list': endpoint('/garden/bed/list'), 'bed  list': endpoint('/garden/bed//list') },
  }
  expect(() => buildCommandTree(groups)).toThrow(
    'Endpoints /garden/bed/list and /garden/bed//list both map to the command: terros garden bed list'
  )
})
