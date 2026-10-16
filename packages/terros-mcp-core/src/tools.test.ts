import { buildTools } from './tools.ts'
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

const client = { call: vi.fn() }

it('keeps both tools of paths that shared a command name under the old two-segment naming', () => {
  const tools = buildTools(parseEndpoints(spec('/bed/list', '/garden/bed/list')), client)
  expect(tools.map((tool) => tool.name).sort()).toEqual(['bed_list', 'garden_bed_list'])
})

it('names each tool from its full route and calls that route', async () => {
  const tools = buildTools(parseEndpoints(spec('/search', '/garden/bed/tag/add')), client)
  expect(tools.map((tool) => tool.name).sort()).toEqual(['garden_bed_tag_add', 'search'])
  await tools.find((tool) => tool.name === 'garden_bed_tag_add')?.call({ id: 'bed-1' })
  expect(client.call).toHaveBeenCalledWith('garden/bed/tag/add', { id: 'bed-1' })
})
