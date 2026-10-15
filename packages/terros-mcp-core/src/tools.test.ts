import { buildTools, type ApiClient } from './tools.ts'
import { getEndpoint, getEndpointSubcommandNames } from './command.ts'
import { loadEndpoints } from './index.ts'

// The export routes as the Terros OpenAPI document publishes them.
const spec = `
openapi: 3.1.1
paths:
${['add', 'download', 'get', 'list', 'remove']
  .map(
    (alias) => `  /export/${alias}:
    post:
      description: ${alias} exports
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                exportId:
                  $ref: '#/components/schemas/ExportId'`
  )
  .join('\n')}
components:
  schemas:
    ExportId:
      type: string
`

it('exposes /export/get as the export_get tool, calling the route without a leading slash', async () => {
  const call = vi.fn<ApiClient['call']>().mockResolvedValue({ type: 'success' })
  const tools = buildTools(await loadEndpoints({ bundled: spec }), { call })
  const tool = tools.find((candidate) => candidate.name === 'export_get')

  await tool?.call({ exportId: 'Export.example' })

  expect(tools.map((candidate) => candidate.name)).toContain('export_get')
  expect(call).toHaveBeenCalledWith('export/get', { exportId: 'Export.example' })
})

it('resolves `terros export get` to /export/get', async () => {
  const endpoints = await loadEndpoints({ bundled: spec })

  expect(getEndpoint(endpoints.export!, 'export', 'get')?.path).toBe('/export/get')
  expect(getEndpointSubcommandNames(endpoints.export!, 'export')).toEqual(['add', 'download', 'get', 'list', 'remove'])
})
