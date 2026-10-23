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
    call: async (input) => withoutUploadUrls(await client.call(route, input)),
  }
}

// Presigned S3 upload URLs (for example on `company/get` for a caller who may update the company) let anyone holding
// them overwrite that avatar or icon until they expire. Only the apps' image editors need them, so the CLI and MCP
// tools drop them from every response rather than print or hand them to an AI model.
const UPLOAD_URL_KEYS = new Set(['uploadAvatarUrl', 'uploadIconUrl'])

/** The API response without presigned upload URLs, at any depth. */
export function withoutUploadUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUploadUrls)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UPLOAD_URL_KEYS.has(key))
      .map(([key, entry]) => [key, withoutUploadUrls(entry)])
  )
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
