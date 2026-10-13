import { parseEndpoints } from './parser.ts'

function schemaWith(paths: string[]): string {
  const operation = { post: { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } }
  return JSON.stringify({ openapi: '3.1.1', paths: Object.fromEntries(paths.map((path) => [path, operation])) })
}

it('qualifies a nested group that would replace a top-level command', () => {
  const endpoints = parseEndpoints(
    schemaWith(['/garden/get', '/garden/bed/get', '/garden/bed/list', '/bed/get', '/bed/list'])
  )

  expect(endpoints.bed).toMatchObject({ get: { path: '/bed/get' }, list: { path: '/bed/list' } })
  expect(endpoints.garden).toMatchObject({ get: { path: '/garden/get' } })
  expect(endpoints.gardenBed).toMatchObject({
    get: { path: '/garden/bed/get' },
    list: { path: '/garden/bed/list' },
  })
})

it('keeps the short group for nested paths that do not collide', () => {
  const endpoints = parseEndpoints(schemaWith(['/orchard/tree/list', '/farm/barn/stall/add', '/pond/fish/add']))

  expect(Object.keys(endpoints).sort()).toEqual(['fish', 'stall', 'tree'])
})

it('rejects two paths that map to the same command', () => {
  expect(() => parseEndpoints(schemaWith(['/a/item/list', '/b/item/list']))).toThrow(
    'Paths /a/item/list and /b/item/list both map to command: item list'
  )
})

it('qualifies only against groups of direct and two-segment paths', () => {
  const endpoints = parseEndpoints(schemaWith(['/garden/bed/list', '/bed/plot/list']))

  expect(endpoints.bed).toMatchObject({ list: { path: '/garden/bed/list' } })
  expect(endpoints.plot).toMatchObject({ list: { path: '/bed/plot/list' } })
})

it('accepts aliases that match Object.prototype properties', () => {
  expect(parseEndpoints(schemaWith(['/foo/toString', '/foo/constructor'])).foo).toMatchObject({
    toString: { path: '/foo/toString' },
    constructor: { path: '/foo/constructor' },
  })
})
