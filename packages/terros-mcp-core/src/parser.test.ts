import { parseEndpoints } from './parser.ts'

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

it('keys each endpoint by its first segment and the rest of its full path', () => {
  const endpoints = parseEndpoints(spec('/bed/list', '/garden/bed/list', '/garden/bed/tag/add'))
  expect(endpoints).toHaveProperty(['bed', 'list', 'path'], '/bed/list')
  expect(endpoints).toHaveProperty(['garden', 'bed list', 'path'], '/garden/bed/list')
  expect(endpoints).toHaveProperty(['garden', 'bed tag add', 'path'], '/garden/bed/tag/add')
})

it('keeps a single-segment path as a direct command', () => {
  expect(parseEndpoints(spec('/search')).search?.['']?.path).toBe('/search')
})

it('accepts a single-segment path next to longer paths under the same word', () => {
  const endpoints = parseEndpoints(spec('/orchard', '/orchard/tree/list'))
  expect(endpoints.orchard?.['']?.path).toBe('/orchard')
  expect(endpoints).toHaveProperty(['orchard', 'tree list', 'path'], '/orchard/tree/list')
})

it('fails when two paths map to the same command, naming both paths', () => {
  expect(() => parseEndpoints(spec('/garden/bed/list', '/garden//bed/list/'))).toThrow(
    'Endpoints /garden/bed/list and /garden//bed/list/ both map to the command: terros garden bed list'
  )
})

it('fails when a path uses the reserved help word', () => {
  expect(() => parseEndpoints(spec('/garden/help'))).toThrow(
    'Endpoint path /garden/help uses the reserved command word'
  )
})

it('fails on a path with no segments', () => {
  expect(() => parseEndpoints(spec('/'))).toThrow('Endpoint path has no command: /')
})

it('accepts Object.prototype names as commands', () => {
  const endpoints = parseEndpoints(spec('/toString', '/constructor/list', '/garden/hasOwnProperty'))
  expect(Object.hasOwn(endpoints, 'toString')).toBe(true)
  expect(endpoints.constructor?.list?.path).toBe('/constructor/list')
  expect(endpoints.garden?.hasOwnProperty?.path).toBe('/garden/hasOwnProperty')
})
