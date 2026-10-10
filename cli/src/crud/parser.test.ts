import { parseEndpoints } from './parser'

function schemaWith(paths: string[]): string {
  const operation = { post: { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } }
  return JSON.stringify({ openapi: '3.1.1', paths: Object.fromEntries(paths.map((path) => [path, operation])) })
}

it('qualifies a nested group that would replace a top-level command', () => {
  const endpoints = parseEndpoints(
    schemaWith(['/program/get', '/program/user/get', '/program/user/list', '/user/get', '/user/list'])
  )

  expect(endpoints.user).toMatchObject({ get: { path: '/user/get' }, list: { path: '/user/list' } })
  expect(endpoints.program).toMatchObject({ get: { path: '/program/get' } })
  expect(endpoints.programUser).toMatchObject({
    get: { path: '/program/user/get' },
    list: { path: '/program/user/list' },
  })
})

it('keeps the short group for nested paths that do not collide', () => {
  const endpoints = parseEndpoints(schemaWith(['/calendar/event/list', '/connect/app/version/add', '/team/member/add']))

  expect(Object.keys(endpoints).sort()).toEqual(['event', 'member', 'version'])
})

it('rejects two paths that map to the same command', () => {
  expect(() => parseEndpoints(schemaWith(['/a/item/list', '/b/item/list']))).toThrow(
    'Paths /a/item/list and /b/item/list both map to command: item list'
  )
})
