import type { CommandGroup, CommandRegistry, Subcommand } from './types.ts'
import { connectCommands } from './connect.ts'
import { authCommands } from './auth.ts'

export const commandRegistry: CommandRegistry = {
  auth: {
    description: 'Manage authentication',
    subcommands: authCommands,
  },
  connect: {
    description: 'Terros Connect',
    subcommands: connectCommands,
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
