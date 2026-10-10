import { startMcpServer } from '../mcp'
import type { CommandGroup, CommandRegistry, Subcommand } from './types'
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
}

export function getCommandGroup(command: string): CommandGroup | undefined {
  return commandRegistry[command]
}

export function getSubcommand(command: string, subcommand: string): Subcommand | undefined {
  return getCommandGroup(command)?.subcommands[subcommand]
}

export function getCommandNames(): string[] {
  return Object.keys(commandRegistry).sort()
}

export function getSubcommandNames(command: string): string[] {
  const commandGroup = getCommandGroup(command)
  if (!commandGroup) return []
  return Object.keys(commandGroup.subcommands).sort()
}
