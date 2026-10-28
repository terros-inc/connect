import { whoamiCommand } from './whoami'
import type { CommandGroup, CommandRegistry } from './types'
import { connectCommands } from './connect'
import { authCommands } from './auth'
import { apiCommands } from './api'

const MCP_REMOVED_MESSAGE = `\`terros mcp\`, the local stdio MCP server, was removed in @terros-inc/cli 3.0.0.
Connect your AI client to the hosted Terros MCP server instead: add https://mcp.terros.com/mcp as a remote (HTTP)
MCP server and sign in with your Terros account. Setup: https://github.com/terros-inc/connect/tree/main/cli#ai-clients
To keep the local server while you migrate, start it from CLI 2 instead: npx -y @terros-inc/cli@2 mcp`

export const commandRegistry: CommandRegistry = {
  api: {
    description: 'Inspect API usage',
    subcommands: apiCommands,
  },
  auth: {
    description: 'Manage authentication',
    subcommands: authCommands,
  },
  connect: {
    description: 'Terros Connect',
    subcommands: connectCommands,
  },
  // The local stdio server is gone, but AI client configurations still start `terros mcp`. It stays a built-in so they
  // get a migration message on stderr (an unknown command would print help to stdout, the client's protocol stream),
  // and so the API's lint keeps reserving the word for it.
  mcp: {
    description: 'Removed: connect AI clients to the hosted Terros MCP server, https://mcp.terros.com/mcp',
    run: () => {
      throw new Error(MCP_REMOVED_MESSAGE)
    },
    subcommands: {},
  },
  whoami: {
    ...whoamiCommand,
    subcommands: {},
  },
}

export function getCommandGroup(command: string): CommandGroup | undefined {
  return Object.hasOwn(commandRegistry, command) ? commandRegistry[command] : undefined
}

export function getCommandNames(): string[] {
  return Object.keys(commandRegistry).sort()
}

export function getSubcommandNames(command: string): string[] {
  const commandGroup = getCommandGroup(command)
  if (!commandGroup) return []
  return Object.keys(commandGroup.subcommands).sort()
}
