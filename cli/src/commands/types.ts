import type { ParsedArgs } from 'minimist'

export type CommandContext = {
  params: ParsedArgs
  args: string[]
}

export type Subcommand = {
  description: string
  run: (context: CommandContext) => Promise<void> | void
}

export type CommandGroup = {
  description: string
  subcommands: Record<string, Subcommand>
}

export type CommandRegistry = Record<string, CommandGroup>
