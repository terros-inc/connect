import { McpServer } from '@modelcontextprotocol/server'
import { getStandardInputSchema } from './validator.ts'
import { getInputSchema } from './schema.ts'
import { registerMetaTools } from './metaTools.ts'
import type { EndpointGroups } from './endpoint.ts'
import type { ApiClient } from './client.ts'
import { buildCatalog, type CatalogEntry } from './catalog.ts'
import { getToolAnnotations } from './annotations.ts'

export type BuiltTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
  call(input: Record<string, unknown>): Promise<unknown>
}

/**
 * How API operations are exposed as MCP tools.
 * - `endpoints`: one tool per operation (the original behaviour).
 * - `meta`: three tools, `terros_search_tools`, `terros_describe_tool` and `terros_call`, over the same operations.
 */
export type ToolMode = 'endpoints' | 'meta'

export const TOOL_MODES: ToolMode[] = ['endpoints', 'meta']

export function buildTools(endpoints: EndpointGroups, client: ApiClient): BuiltTool[] {
  return buildCatalog(endpoints).entries.map((entry) => buildTool(entry, client))
}

function buildTool(entry: CatalogEntry, client: ApiClient): BuiltTool {
  return {
    name: entry.name,
    description: entry.endpoint.description,
    inputSchema: getInputSchema(entry.endpoint),
    readOnly: entry.readOnly,
    call: (input) => client.call(entry.route, input),
  }
}

export type CreateMcpServerOptions = {
  endpoints: EndpointGroups
  client: ApiClient
  name?: string
  version: string
  /** Defaults to `endpoints`. */
  mode?: ToolMode
  /** Only expose operations in these toolsets (first OpenAPI tag, e.g. `calendar`). All when omitted. */
  toolsets?: string[]
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer({ name: options.name ?? 'terros', version: options.version })
  const catalog = buildCatalog(options.endpoints, { toolsets: options.toolsets })
  if (options.mode === 'meta') {
    registerMetaTools({ server, catalog, client: options.client })
    return server
  }
  for (const entry of catalog.entries) {
    server.registerTool(
      entry.name,
      {
        description: entry.endpoint.description,
        inputSchema: getStandardInputSchema(entry.endpoint),
        annotations: getToolAnnotations(entry),
      },
      async (input) => ({
        content: [{ type: 'text', text: JSON.stringify(await options.client.call(entry.route, input)) }],
      })
    )
  }
  return server
}
