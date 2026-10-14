import {
  buildCatalog,
  createMcpServer as createCoreMcpServer,
  TOOL_MODES,
  type EndpointGroups,
  type ToolMode,
} from '@terros-inc/mcp-core'
import { getTokens } from '@terros-inc/connect-common/auth'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { McpServer } from '@modelcontextprotocol/server'
import packageJson from '../package.json'
import { loadEndpoints } from './loadEndpoints'
import type { CommandContext } from './commands/types'
import { buildTerrosClient } from './api/query'

export type McpToolOptions = {
  mode?: ToolMode
  toolsets?: string[]
}

export async function startMcpServer(context?: CommandContext): Promise<void> {
  const options = parseMcpToolOptions(context?.params ?? { _: [] })
  const tokens = await getTokens()
  if (!tokens?.access_token) {
    throw new Error('CLI not authorized. Run `terros auth login` to authenticate.')
  }

  const endpoints = await loadEndpoints()
  // Fail on an unknown toolset now rather than on the client's first connection.
  buildCatalog(endpoints, { toolsets: options.toolsets })
  serveStdio(() => createMcpServer(endpoints, options), {
    onerror: (error) => console.error(error.message),
  })
}

export function createMcpServer(endpoints: EndpointGroups, options: McpToolOptions = {}): McpServer {
  return createCoreMcpServer({ endpoints, client: buildTerrosClient(), version: packageJson.version, ...options })
}

/** `--tools endpoints|meta` and `--toolsets account,calendar`. */
export function parseMcpToolOptions(params: CommandContext['params']): McpToolOptions {
  const options: McpToolOptions = {}
  if (params.tools !== undefined) {
    const mode = String(params.tools)
    if (!isToolMode(mode)) throw new Error(`--tools must be one of: ${TOOL_MODES.join(', ')}`)
    options.mode = mode
  }
  if (params.toolsets !== undefined) {
    if (typeof params.toolsets !== 'string') throw new Error('--toolsets needs a comma-separated list of toolset names')
    const toolsets = params.toolsets
      .split(',')
      .map((toolset) => toolset.trim())
      .filter((toolset) => toolset.length > 0)
    if (toolsets.length === 0) throw new Error('--toolsets needs at least one toolset name')
    options.toolsets = toolsets
  }
  return options
}

function isToolMode(value: string): value is ToolMode {
  return TOOL_MODES.some((mode) => mode === value)
}
