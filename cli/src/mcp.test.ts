import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { getTokens } from '@terros-inc/connect-common/auth'
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio'
import type { McpServer, JSONRPCMessage } from '@modelcontextprotocol/server'
import { createMcpServer, startMcpServer } from './mcp'
import type { OpenAPISchema } from './crud/types'
import type { EndpointGroups } from './crud/endpoint'
import { loadEndpoints } from './crud'
import { buildTerrosClient } from './api/query'

vi.mock('@terros-inc/connect-common/auth', () => ({ getTokens: vi.fn() }))
vi.mock('./crud', () => ({ loadEndpoints: vi.fn() }))
vi.mock('./api/query', () => ({ buildTerrosClient: vi.fn() }))
vi.mock('@modelcontextprotocol/server/stdio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/server/stdio')>()),
  serveStdio: vi.fn(),
}))

const endpoints: EndpointGroups = {
  account: {
    get: {
      path: '/account/get',
      description: 'Get an account',
      properties: {
        type: 'object',
        properties: { id: { $ref: '#/components/schemas/Id' } },
        required: ['id'],
      },
      components: {
        schemas: {
          Id: { type: 'string' },
          Unused: { type: 'number' },
        },
      },
    },
  },
  search: {
    search: {
      path: '/search',
      properties: { type: 'object', properties: { query: { type: 'string' } } },
      components: { schemas: {} },
    },
  },
}

const call = vi.fn()
let server: McpServer | undefined

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(loadEndpoints).mockResolvedValue(endpoints)
  vi.mocked(buildTerrosClient).mockReturnValue({ call } as unknown as ReturnType<typeof buildTerrosClient>)
})

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('startMcpServer', () => {
  it('rejects an unauthenticated user before starting stdio or loading tools', async () => {
    vi.mocked(getTokens).mockResolvedValue(null)
    await expect(startMcpServer()).rejects.toThrow('terros auth login')
    expect(serveStdio).not.toHaveBeenCalled()
    expect(loadEndpoints).not.toHaveBeenCalled()
  })

  it('propagates a failed token refresh without starting stdio', async () => {
    vi.mocked(getTokens).mockRejectedValue(new Error('Unable to refresh token'))
    await expect(startMcpServer()).rejects.toThrow('Unable to refresh token')
    expect(serveStdio).not.toHaveBeenCalled()
  })

  it('starts stdio after checking the saved login', async () => {
    vi.mocked(getTokens).mockResolvedValue({
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      id_token: undefined,
      token_type: 'Bearer',
      expires_at: Date.now() + 3600000,
    })
    await startMcpServer()
    expect(serveStdio).toHaveBeenCalledOnce()
    expect(loadEndpoints).toHaveBeenCalledOnce()
  })
})

async function connect(groups = endpoints): Promise<(method: string, params?: object) => Promise<any>> {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let nextId = 0
  let buffer = ''
  const pending = new Map<number, (message: JSONRPCMessage) => void>()
  stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  })
  server = createMcpServer(groups)
  await server.connect(new StdioServerTransport(stdin, stdout))
  const request = (method: string, params: object = {}): Promise<any> => {
    const id = ++nextId
    return new Promise((resolve) => {
      pending.set(id, resolve)
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
  const initialized = await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  })
  expect(initialized.result.serverInfo.name).toBe('terros')
  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  return request
}

describe('MCP stdio tools', () => {
  it('lists grouped and direct endpoints with self-contained schemas', async () => {
    const request = await connect()
    const response = await request('tools/list')
    expect(response.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['account_get', 'search'])
    expect(response.result.tools[0]).toMatchObject({
      description: 'Get an account',
      inputSchema: {
        required: ['id'],
        components: { schemas: { Id: { type: 'string' } } },
      },
    })
    expect(response.result.tools[0].inputSchema.components.schemas).not.toHaveProperty('Unused')
  })

  it('calls the API with validated arguments and a route without a leading slash', async () => {
    const request = await connect()
    call.mockResolvedValue({ id: 'A.1' })
    const response = await request('tools/call', { name: 'account_get', arguments: { id: 'A.1' } })
    expect(call).toHaveBeenCalledWith('account/get', { id: 'A.1' })
    expect(response.result.content).toEqual([{ type: 'text', text: '{"id":"A.1"}' }])
  })

  it('rejects invalid arguments without calling the API', async () => {
    const request = await connect()
    const response = await request('tools/call', { name: 'account_get', arguments: { id: 123 } })
    expect(response.result.isError).toBe(true)
    expect(call).not.toHaveBeenCalled()
  })

  it('returns API failures as MCP tool errors', async () => {
    const request = await connect()
    call.mockRejectedValue(new Error('Account not found'))
    const response = await request('tools/call', { name: 'account_get', arguments: { id: 'A.1' } })
    expect(response.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Account not found' }],
    })
  })

  it('registers and lists every tool from the bundled OpenAPI document', async () => {
    const document = parse(readFileSync(new URL('../terros.yml', import.meta.url), 'utf8')) as OpenAPISchema
    const groups: EndpointGroups = { api: {} }
    for (const [path, config] of Object.entries(document.paths)) {
      groups.api![path] = {
        path,
        description: config.post.description,
        properties: config.post.requestBody.content['application/json'].schema,
        components: document.components,
      }
    }
    const request = await connect(groups)
    const response = await request('tools/list')
    expect(response.error).toBeUndefined()
    expect(response.result.tools).toHaveLength(Object.keys(document.paths).length)
  })
})
