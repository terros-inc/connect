import { buildTools, withoutUploadUrls } from './tools.ts'
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

// `company/get` returns presigned avatar and icon upload URLs to a caller who may update the company; printing them
// would hand a write credential to the terminal or an AI model.
it('drops presigned upload URLs from a tool response at any depth', async () => {
  const company = { companyId: 'C.example', avatarUrl: 'https://cdn.example.test/a.png' }
  client.call.mockResolvedValueOnce({
    type: 'success',
    company: {
      ...company,
      uploadAvatarUrl: 'https://upload.example.test/a',
      uploadIconUrl: 'https://upload.example.test/i',
    },
  })
  const [tool] = buildTools(parseEndpoints(spec('/company/get')), client)
  expect(await tool.call({})).toEqual({ type: 'success', company })
  expect(withoutUploadUrls({ teams: [{ teamId: 'T.example', uploadAvatarUrl: 'x' }], count: 1 })).toEqual({
    teams: [{ teamId: 'T.example' }],
    count: 1,
  })
})
