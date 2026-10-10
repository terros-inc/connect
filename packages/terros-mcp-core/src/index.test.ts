import { loadEndpoints } from './index.ts'

const spec = (path: string): string => `
openapi: 3.1.1
paths:
  ${path}:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
components:
  schemas: {}
`

it('uses the bundled spec when the internal source is unavailable', async () => {
  expect(await loadEndpoints({ bundled: spec('/company/get'), internal: async () => undefined })).toHaveProperty(
    'company.get.path',
    '/company/get'
  )
})

it('prefers the internal spec without reading the bundled source', async () => {
  const bundled = vi.fn(() => spec('/company/get'))
  const endpoints = await loadEndpoints({ bundled, internal: async () => spec('/company/list') })
  expect(endpoints).toHaveProperty('company.list.path', '/company/list')
  expect(bundled).not.toHaveBeenCalled()
})
