import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server'
import { getInputSchema } from './schema.ts'
import type { Endpoint, EndpointGroups } from './endpoint.ts'

export type ApiClient = {
  call<Success>(route: string, input: object): Promise<Success>
}

export type BuiltTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  call(input: Record<string, unknown>): Promise<unknown>
}

export function buildTools(endpoints: EndpointGroups, client: ApiClient): BuiltTool[] {
  return Object.values(endpoints).flatMap((group) =>
    Object.values(group).map((endpoint) => buildTool(endpoint, client))
  )
}

function buildTool(endpoint: Endpoint, client: ApiClient): BuiltTool {
  const route = endpoint.path.replace(/^\//, '')
  return {
    name: route.replaceAll('/', '_'),
    description: endpoint.description,
    inputSchema: getInputSchema(endpoint),
    call: (input) => client.call(route, input),
  }
}

export type CreateMcpServerOptions = {
  endpoints: EndpointGroups
  client: ApiClient
  name?: string
  version: string
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer({ name: options.name ?? 'terros', version: options.version })
  for (const tool of buildTools(options.endpoints, options.client)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
      },
      async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await tool.call(input)) }] })
    )
  }
  return server
}
