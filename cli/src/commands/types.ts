import type { ParsedArgs } from 'minimist'
import type { EndpointParameter } from '@terros-inc/mcp-core'

export type CommandContext = {
  params: ParsedArgs
  args: string[]
}

export type Subcommand = {
  description: string
  parameters?: EndpointParameter[]
  run: (context: CommandContext) => Promise<void> | void
}

export type CommandGroup = {
  description: string
  run?: Subcommand['run']
  parameters?: EndpointParameter[]
  subcommands: Record<string, Subcommand>
}

export type CommandRegistry = Record<string, CommandGroup>
