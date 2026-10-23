import { startMcpServer } from '../mcp'
import { whoamiCommand } from './whoami'
import { userCommands } from './user'
import type { CommandGroup, CommandRegistry } from './types'
import { connectCommands } from './connect'
import { authCommands } from './auth'
import { apiCommands } from './api'

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
  mcp: {
    description: 'Serve Terros API tools over MCP stdio. Run `terros auth login` first.',
    run: startMcpServer,
    subcommands: {},
  },
  user: {
    description: 'Inspect users',
    subcommands: userCommands,
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
