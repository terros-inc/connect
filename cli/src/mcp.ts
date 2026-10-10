import { createMcpServer as createCoreMcpServer, type EndpointGroups } from '@terros-inc/mcp-core'
import { getTokens } from '@terros-inc/connect-common/auth'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { McpServer } from '@modelcontextprotocol/server'
import packageJson from '../package.json'
import { loadEndpoints } from './loadEndpoints'
import { buildTerrosClient } from './api/query'

export async function startMcpServer(): Promise<void> {
  const tokens = await getTokens()
  if (!tokens?.access_token) {
    throw new Error('CLI not authorized. Run `terros auth login` to authenticate.')
  }

  const endpoints = await loadEndpoints()
  serveStdio(() => createMcpServer(endpoints), {
    onerror: (error) => console.error(error.message),
  })
}

export function createMcpServer(endpoints: EndpointGroups): McpServer {
  return createCoreMcpServer({ endpoints, client: buildTerrosClient(), version: packageJson.version })
}
