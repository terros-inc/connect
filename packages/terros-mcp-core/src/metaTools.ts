import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server'
import { validateEndpointInput } from './validator.ts'
import { DEFAULT_SEARCH_LIMIT, searchCatalog, type SearchResult } from './search.ts'
import { getInputSchema } from './schema.ts'
import type { ApiClient } from './client.ts'
import { getToolsetNames, type Catalog, type CatalogEntry } from './catalog.ts'
import { getToolAnnotations } from './annotations.ts'

export const SEARCH_TOOL = 'terros_search_tools'
export const DESCRIBE_TOOL = 'terros_describe_tool'
export const CALL_TOOL = 'terros_call'

const MAX_SEARCH_LIMIT = 25

export type MetaToolsOptions = {
  server: McpServer
  catalog: Catalog
  client: ApiClient
}

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** Register search, describe and call tools that expose every catalog operation through three tools. */
export function registerMetaTools(options: MetaToolsOptions): void {
  const { server, catalog, client } = options
  const toolsets = getToolsetNames(catalog)

  server.registerTool(
    SEARCH_TOOL,
    {
      description:
        `Find Terros API operations by keywords. Returns compact matches; call ${DESCRIBE_TOOL} for an operation's ` +
        `input schema, then ${CALL_TOOL} to run it. Toolsets: ${toolsets.join(', ')}.`,
      inputSchema: fromJsonSchema<{ query: string; toolset?: string; limit?: number }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words describing the task, e.g. "list calendar events".' },
          toolset: { type: 'string', enum: toolsets, description: 'Only search this toolset.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT },
        },
        required: ['query'],
      }),
      annotations: getToolAnnotations(true),
    },
    async ({ query, toolset, limit }) => {
      const scoped = toolset ? scopeCatalog(catalog, toolset) : catalog
      return text(formatSearchResults(searchCatalog(scoped, query, limit ?? DEFAULT_SEARCH_LIMIT), toolsets))
    }
  )

  server.registerTool(
    DESCRIBE_TOOL,
    {
      description: `Get the full input schema and description of one Terros API operation found with ${SEARCH_TOOL}.`,
      inputSchema: fromJsonSchema<{ name: string }>({
        type: 'object',
        properties: { name: { type: 'string', description: 'Operation name, e.g. "account_get".' } },
        required: ['name'],
      }),
      annotations: getToolAnnotations(true),
    },
    async ({ name }) => {
      const entry = catalog.find(name)
      if (!entry) return unknownOperation(catalog, name)
      return text(JSON.stringify(describeEntry(entry)))
    }
  )

  server.registerTool(
    CALL_TOOL,
    {
      description:
        `Run one Terros API operation as the signed-in user. Arguments are checked against the schema from ` +
        `${DESCRIBE_TOOL}. Operations that are not read-only can change data.`,
      inputSchema: fromJsonSchema<{ name: string; args?: Record<string, unknown> }>({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Operation name, e.g. "account_get".' },
          args: { type: 'object', description: 'Operation input matching its schema.' },
        },
        required: ['name'],
      }),
      annotations: getToolAnnotations(false),
    },
    async ({ name, args }) => {
      const entry = catalog.find(name)
      if (!entry) return unknownOperation(catalog, name)
      const input = args ?? {}
      const issue = validateEndpointInput(entry.endpoint, input)
      if (issue) {
        return error(
          `Invalid arguments for ${name}: ${issue}. Call ${DESCRIBE_TOOL} with {"name":"${name}"} for its schema.`
        )
      }
      return text(JSON.stringify(await client.call(entry.route, input)))
    }
  )
}

export type OperationDescription = {
  name: string
  toolset: string
  readOnly: boolean
  description: string
  inputSchema: Record<string, unknown>
}

export function describeEntry(entry: CatalogEntry): OperationDescription {
  return {
    name: entry.name,
    toolset: entry.toolset,
    readOnly: entry.readOnly,
    description: entry.endpoint.description?.trim() ?? entry.summary,
    inputSchema: getInputSchema(entry.endpoint),
  }
}

/** One line per match: `name (toolset, read|write): summary`. */
export function formatSearchResults(results: SearchResult[], toolsets: string[]): string {
  if (results.length === 0) {
    return `No operations matched. Try other words, or pass one of these toolsets: ${toolsets.join(', ')}.`
  }
  return results
    .map((result) => `${result.name} (${result.toolset}, ${result.readOnly ? 'read' : 'write'}): ${result.summary}`)
    .join('\n')
}

function scopeCatalog(catalog: Catalog, toolset: string): Catalog {
  const entries = catalog.entries.filter((entry) => entry.toolset === toolset)
  return { entries, find: (name) => entries.find((entry) => entry.name === name) }
}

function unknownOperation(catalog: Catalog, name: string): TextResult {
  const suggestions = searchCatalog(catalog, name, 3).map((result) => result.name)
  const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : ''
  return error(`Unknown operation "${name}".${hint} Use ${SEARCH_TOOL} to find operations.`)
}

function text(value: string): TextResult {
  return { content: [{ type: 'text', text: value }] }
}

function error(value: string): TextResult {
  return { ...text(value), isError: true }
}
