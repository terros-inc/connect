import { readFileSync } from 'node:fs'
import { loadInternalSchema } from './internal'
import { loadEndpoints } from './index'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
vi.mock('./internal', () => ({ loadInternalSchema: vi.fn() }))

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
  expect(await loadEndpoints()).toHaveProperty('company.get.path', '/company/get')
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

it('exposes API history start and status as internal CLI commands', async () => {
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
            properties: {
              companyId: { type: 'string' },
              status: { type: 'integer' },
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
  expect(endpoints.apiHistory!.start!.components.schemas.Input.required ?? []).not.toContain('companyId')
  expect(endpoints.apiHistory!.start!.components.schemas.Input.properties).toHaveProperty('status')
  expect(endpoints.apiHistory!.start!.components.schemas.Input.properties).toHaveProperty('endpoint')
  expect(endpoints.apiHistory!.start!.components.schemas.Input.properties).toHaveProperty('since')
})
