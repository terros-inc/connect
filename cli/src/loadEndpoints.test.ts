import { readFileSync } from 'node:fs'
import { loadEndpoints } from './loadEndpoints'
import { loadInternalSchema } from './crud/internal'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
vi.mock('./crud/internal', () => ({ loadInternalSchema: vi.fn() }))

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

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readFileSync).mockReturnValue(publicSchema)
})

it('uses bundled YAML when no internal schema is available', async () => {
  vi.mocked(loadInternalSchema).mockResolvedValue(undefined)
  const endpoints = await loadEndpoints()
  expect(endpoints).toHaveProperty('company.get.path', '/company/get')
  expect(endpoints).toHaveProperty('ratio.get.path', '/ratio/get')
  expect(endpoints).toHaveProperty('ratio.list.path', '/ratio/list')
})

it('uses an API-provided ratio write endpoint instead of its fallback', async () => {
  vi.mocked(loadInternalSchema).mockResolvedValue(
    publicSchema
      .replace('/company/get', '/ratio/add')
      .replace('    post:\n', '    post:\n      description: From the API\n')
  )

  expect(await loadEndpoints()).toHaveProperty('ratio.add.description', 'From the API')
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

it('keeps ratio read definitions supplied by a downloaded internal schema', async () => {
  vi.mocked(loadInternalSchema).mockResolvedValue(
    JSON.stringify({
      openapi: '3.1.1',
      paths: {
        '/ratio/get': {
          post: {
            description: 'Downloaded ratio get.',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      components: { schemas: {} },
    })
  )

  const endpoints = await loadEndpoints()
  expect(endpoints.ratio?.get.description).toBe('Downloaded ratio get.')
  expect(endpoints).toHaveProperty('ratio.list.path', '/ratio/list')
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
