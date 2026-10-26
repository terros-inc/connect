import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { loadEndpoints, loadEndpointsAfterRefresh } from './loadEndpoints'
import { loadInternalSchema, loadInternalSchemaWithStatus } from './crud/internal'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.path,
}))
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
vi.mock('./crud/internal', () => ({ loadInternalSchema: vi.fn(), loadInternalSchemaWithStatus: vi.fn() }))

const publicSchema = `
openapi: 3.1.1
paths:
  /company/get:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Input'
components:
  schemas:
    Input:
      type: object
      properties:
        companyId:
          type: string
`
const livePublicSchema = (...paths: string[]): string =>
  JSON.stringify({
    openapi: '3.1.1',
    paths: Object.fromEntries(
      paths.map((path) => [
        path,
        { post: { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } },
      ])
    ),
  })
const fetch = vi.fn<typeof globalThis.fetch>()
const minute = 60 * 1000
const commands = (endpoints: Awaited<ReturnType<typeof loadEndpoints>>): string[] =>
  Object.entries(endpoints).flatMap(([group, entries]) => Object.keys(entries).map((name) => `${group} ${name}`))

beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  home.path = await mkdtemp(join(tmpdir(), 'terros-public-schema-'))
  vi.mocked(readFileSync).mockReturnValue(publicSchema)
  vi.mocked(loadInternalSchema).mockResolvedValue(undefined)
  vi.mocked(loadInternalSchemaWithStatus).mockResolvedValue({ status: 'unavailable' })
  fetch.mockRejectedValue(new TypeError('fetch failed'))
})

afterEach(async () => {
  await rm(home.path, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses bundled YAML on a first run that cannot reach the public schema', async () => {
  expect(await loadEndpoints()).toHaveProperty('company.get.path', '/company/get')
})

it('shows public endpoints added after the CLI was built', async () => {
  fetch.mockResolvedValue(new Response(livePublicSchema('/company/get', '/game/list'), { headers: { etag: '"v2"' } }))
  expect(commands(await loadEndpoints())).toEqual(['company get', 'game list'])
})

it('revalidates the public schema with its ETag and keeps the cached copy on 304', async () => {
  fetch.mockResolvedValueOnce(new Response(livePublicSchema('/game/list'), { headers: { etag: '"v2"' } }))
  await loadEndpoints()

  vi.mocked(Date.now).mockReturnValue(Date.now() + 5 * minute - 1)
  expect(commands(await loadEndpoints())).toEqual(['game list'])
  expect(fetch).toHaveBeenCalledOnce()

  vi.mocked(Date.now).mockReturnValue(Date.now() + 1)
  fetch.mockResolvedValueOnce(new Response(null, { status: 304 }))
  expect(commands(await loadEndpoints())).toEqual(['game list'])
  expect(new Headers(fetch.mock.calls[1]![1]!.headers).get('if-none-match')).toBe('"v2"')
})

it.each([
  ['offline', () => fetch.mockRejectedValue(new TypeError('fetch failed'))],
  ['an error response', () => fetch.mockResolvedValue(new Response('Bad gateway', { status: 502 }))],
  ['not an API document', () => fetch.mockResolvedValue(new Response('<html>Sign in to Wi-Fi</html>'))],
])('keeps the last good public schema when the check is %s', async (_, failure) => {
  fetch.mockResolvedValueOnce(new Response(livePublicSchema('/game/list'), { headers: { etag: '"v2"' } }))
  await loadEndpoints()
  vi.mocked(Date.now).mockReturnValue(Date.now() + 5 * minute)
  failure()

  expect(commands(await loadEndpoints())).toEqual(['game list'])
  const cache = JSON.parse(await readFile(join(home.path, '.config', 'terros', 'public-openapi.json'), 'utf8'))
  expect(cache.data).toMatchObject({ etag: '"v2"', schema: livePublicSchema('/game/list') })
})

it('does not wait on an unreachable network again until the next check is due', async () => {
  await loadEndpoints()
  vi.mocked(Date.now).mockReturnValue(Date.now() + 5 * minute - 1)
  await loadEndpoints()
  expect(fetch).toHaveBeenCalledOnce()
})

it('gives up on a hung public schema request instead of hanging the command', async () => {
  fetch.mockImplementation(
    (_, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
  )
  // The real two-second timeout runs, so this fails by hanging if the request is not bounded.
  expect(await loadEndpoints()).toHaveProperty('company.get.path', '/company/get')
})

it('revalidates a missing command against the live public schema right away', async () => {
  fetch.mockResolvedValueOnce(new Response(livePublicSchema('/company/get'), { headers: { etag: '"v1"' } }))
  await loadEndpoints()
  fetch.mockResolvedValueOnce(
    new Response(livePublicSchema('/company/get', '/game/list'), { headers: { etag: '"v2"' } })
  )

  const refreshed = await loadEndpointsAfterRefresh()

  expect(commands(refreshed.endpoints)).toEqual(['company get', 'game list'])
  expect(refreshed.schemaStatus).toBe('available')
  expect(commands(await loadEndpoints())).toEqual(['company get', 'game list'])
})

it.each([
  ['the public schema cannot be fetched', 'unavailable', () => fetch.mockRejectedValue(new TypeError('fetch failed'))],
  ['the staff schema failed', 'failed', () => fetch.mockResolvedValue(new Response(livePublicSchema('/game/list')))],
] as const)('reports a failed refresh when %s', async (_, internalStatus, publicResult) => {
  vi.mocked(loadInternalSchemaWithStatus).mockResolvedValue({ status: internalStatus })
  publicResult()
  expect((await loadEndpointsAfterRefresh()).schemaStatus).toBe('failed')
})

it('does not fetch the public schema for staff who load the internal schema', async () => {
  const internal = livePublicSchema('/apiHistory/start')
  vi.mocked(loadInternalSchema).mockResolvedValue(internal)
  vi.mocked(loadInternalSchemaWithStatus).mockResolvedValue({ status: 'available', schema: internal })

  expect(commands(await loadEndpoints())).toEqual(['apiHistory start'])
  expect(await loadEndpointsAfterRefresh()).toMatchObject({ schemaStatus: 'available' })
  expect(fetch).not.toHaveBeenCalled()
})

it('replaces the bundled schema entirely with the internal JSON schema', async () => {
  vi.mocked(loadInternalSchema).mockResolvedValue(
    JSON.stringify({
      openapi: '3.1.1',
      paths: {
        '/company/list': {
          post: {
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } } },
          },
        },
      },
      components: { schemas: { Input: { type: 'object', properties: { archived: { type: 'boolean' } } } } },
    })
  )
  const endpoints = await loadEndpoints()
  expect(Object.keys(endpoints.company!)).toEqual(['list'])
  expect(readFileSync).not.toHaveBeenCalled()
  expect(endpoints.company!.list!.components).toHaveProperty('schemas.Input.properties.archived')
})

it('exposes API history start as an internal CLI command that requires a company ID', async () => {
  vi.mocked(loadInternalSchema).mockResolvedValue(
    JSON.stringify({
      openapi: '3.1.1',
      paths: {
        '/apiHistory/start': {
          post: {
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } } },
          },
        },
      },
      components: {
        schemas: {
          Input: {
            type: 'object',
            required: ['companyId'],
            properties: {
              companyId: { type: 'string' },
              errorsOnly: { type: 'boolean' },
              endpoint: { type: 'string' },
              since: { type: 'string' },
              limit: { type: 'integer' },
            },
          },
        },
      },
    })
  )

  const endpoints = await loadEndpoints()
  const start = endpoints.apiHistory?.start
  expect(start?.path).toBe('/apiHistory/start')
  expect(start?.components).toHaveProperty('schemas.Input.required', ['companyId'])
  for (const name of ['errorsOnly', 'endpoint', 'since']) {
    expect(start?.components).toHaveProperty(['schemas', 'Input', 'properties', name])
  }
})
