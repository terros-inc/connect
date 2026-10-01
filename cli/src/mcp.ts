import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server'
import packageJson from '../package.json'
import type { Schema } from './crud/types'
import type { Endpoint, EndpointGroups } from './crud/endpoint'
import { loadEndpoints } from './crud'
import { getTokens } from '@terros-inc/connect-common/auth'
import { buildTerrosClient } from './api/query'

export async function startMcpServer(): Promise<void> {
  const tokens = await getTokens()
  if (!tokens?.access_token) {
    throw new Error('CLI not authorized. Run `terros auth login` to authenticate.')
  }

  const endpoints = loadEndpoints()
  serveStdio(() => createMcpServer(endpoints), {
    onerror: (error) => console.error(error.message),
  })
}

export function createMcpServer(endpoints: EndpointGroups): McpServer {
  const server = new McpServer({ name: 'terros', version: packageJson.version })
  const client = buildTerrosClient()

  for (const group of Object.values(endpoints)) {
    for (const endpoint of Object.values(group)) {
      const route = endpoint.path.replace(/^\//, '')
      server.registerTool(
        route.replaceAll('/', '_'),
        {
          description: endpoint.description,
          inputSchema: fromJsonSchema<Record<string, unknown>>(getInputSchema(endpoint)),
        },
        async (input) => {
          const response = await client.call(route, input)
          return { content: [{ type: 'text', text: JSON.stringify(response) }] }
        }
      )
    }
  }

  return server
}

function getInputSchema(endpoint: Endpoint): Record<string, unknown> {
  const schemas: Record<string, Schema> = {}

  // Include only referenced components, keeping recursive references intact.
  function collect(value: unknown): void {
    if (value === null || typeof value !== 'object') return
    if ('$ref' in value && typeof value.$ref === 'string') {
      const prefix = '#/components/schemas/'
      if (!value.$ref.startsWith(prefix)) throw new Error(`Unsupported schema reference: ${value.$ref}`)
      const name = value.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~')
      if (!Object.hasOwn(schemas, name)) {
        const schema = endpoint.components?.schemas?.[name]
        if (!schema) throw new Error(`Unknown schema reference: ${value.$ref}`)
        Object.defineProperty(schemas, name, { value: schema, enumerable: true })
        collect(schema)
      }
    }
    for (const child of Object.values(value)) collect(child)
  }

  collect(endpoint.properties)
  return { ...endpoint.properties, components: { schemas } }
}
