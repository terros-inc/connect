import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server'
import { createMcpServer, type CreateMcpServerOptions } from './tools.ts'
import type { EndpointGroups } from './endpoint.ts'

const endpoints: EndpointGroups = {
  account: {
    get: {
      path: '/account/get',
      summary: 'Get Account',
      description: 'Gets one account.',
      tags: ['Account'],
      properties: { type: 'object', properties: { id: { $ref: '#/components/schemas/Id' } }, required: ['id'] },
      components: { schemas: { Id: { type: 'string' }, Unused: { type: 'number' } } },
    },
    update: {
      path: '/account/update',
      summary: 'Update Account',
      tags: ['Account'],
      properties: { type: 'object', properties: { id: { type: 'string' } } },
      components: { schemas: {} },
    },
  },
  event: {
    list: {
      path: '/calendar/event/list',
      summary: 'List Calendar Events',
      tags: ['Calendar'],
      properties: { type: 'object' },
      components: { schemas: {} },
    },
  },
}

const call = vi.fn()

async function connect(
  options: Partial<CreateMcpServerOptions> = {}
): Promise<(method: string, params?: Record<string, unknown>) => Promise<any>> {
  const server = createMcpServer({ endpoints, client: { call }, version: 'test', mode: 'meta', ...options })
  const [client, transport] = InMemoryTransport.createLinkedPair()
  const pending = new Map<number, (message: any) => void>()
  client.onmessage = (message: JSONRPCMessage) => {
    if ('id' in message && typeof message.id === 'number') pending.get(message.id)?.(message)
  }
  await server.connect(transport)
  await client.start()
  let nextId = 0
  const request = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const id = ++nextId
    return new Promise((resolve) => {
      pending.set(id, resolve)
      void client.send({ jsonrpc: '2.0', id, method, params })
    })
  }
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  })
  return request
}

const callTool = async (request: Awaited<ReturnType<typeof connect>>, name: string, args: object) =>
  (await request('tools/call', { name, arguments: args })).result

beforeEach(() => call.mockReset())

it('lists only the three meta-tools, with the call tool marked as possibly destructive', async () => {
  const request = await connect()
  const { tools } = (await request('tools/list')).result
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
    'terros_search_tools',
    'terros_describe_tool',
    'terros_call',
  ])
  expect(tools[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
  expect(tools[2].annotations).toEqual({ readOnlyHint: false, destructiveHint: true })
  expect(tools[0].description).toContain('Toolsets: account, calendar.')
})

it('searches with compact one-line results', async () => {
  const request = await connect()
  expect((await callTool(request, 'terros_search_tools', { query: 'get account' })).content[0].text).toBe(
    'account_get (account, read): Gets one account.\naccount_update (account, write): Update Account'
  )
  expect(
    (await callTool(request, 'terros_search_tools', { query: 'account', toolset: 'calendar' })).content[0].text
  ).toContain('No operations matched')
})

it('describes an operation with its self-contained input schema', async () => {
  const request = await connect()
  const described = JSON.parse(
    (await callTool(request, 'terros_describe_tool', { name: 'account_get' })).content[0].text
  )
  expect(described).toMatchObject({
    name: 'account_get',
    toolset: 'account',
    readOnly: true,
    destructive: false,
    description: 'Gets one account.',
  })
  expect(described.inputSchema).toMatchObject({ required: ['id'], components: { schemas: { Id: { type: 'string' } } } })
  expect(described.inputSchema.components.schemas).not.toHaveProperty('Unused')
})

it('calls the API client with validated arguments', async () => {
  const request = await connect()
  call.mockResolvedValue({ id: 'A.1' })
  const result = await callTool(request, 'terros_call', { name: 'account_get', args: { id: 'A.1' } })
  expect(call).toHaveBeenCalledWith('account/get', { id: 'A.1' })
  expect(result.content).toEqual([{ type: 'text', text: '{"id":"A.1"}' }])
})

it('rejects invalid arguments without calling the API and points to the schema', async () => {
  const request = await connect()
  const result = await callTool(request, 'terros_call', { name: 'account_get', args: { id: 123 } })
  expect(result.isError).toBe(true)
  expect(result.content[0].text).toMatch(/^Invalid arguments for account_get: .+terros_describe_tool/)
  expect(call).not.toHaveBeenCalled()
})

it('suggests close names for an unknown operation', async () => {
  const request = await connect()
  const result = await callTool(request, 'terros_call', { name: 'account_gett', args: {} })
  expect(result).toMatchObject({ isError: true })
  expect(result.content[0].text).toBe(
    'Unknown operation "account_gett". Did you mean: account_get, account_update? Use terros_search_tools to find operations.'
  )
})

it('refuses operations outside the enabled toolsets', async () => {
  const request = await connect({ toolsets: ['calendar'] })
  const result = await callTool(request, 'terros_call', { name: 'account_get', args: { id: 'A.1' } })
  expect(result.isError).toBe(true)
  expect(call).not.toHaveBeenCalled()
})

it('returns API failures as tool errors', async () => {
  const failing = async (): Promise<never> => {
    throw new Error('Account not found')
  }
  const request = await connect({ client: { call: failing } })
  const result = await callTool(request, 'terros_call', { name: 'account_get', args: { id: 'A.1' } })
  expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Account not found' }] })
})

it('filters per-endpoint tools by toolset and annotates reads, writes and destructive operations', async () => {
  const request = await connect({ mode: 'endpoints', toolsets: ['account'] })
  const { tools } = (await request('tools/list')).result
  expect(tools.map((tool: { name: string; annotations: object }) => [tool.name, tool.annotations])).toEqual([
    ['account_get', { readOnlyHint: true, destructiveHint: false }],
    ['account_update', { readOnlyHint: false, destructiveHint: false }],
  ])
})
