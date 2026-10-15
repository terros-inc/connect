import {
  buildCommandTree,
  findCommand,
  getChildCommandNames,
  getEndpointPaths,
  type CommandMatch,
  type CommandNode,
  type EndpointGroups,
} from '@terros-inc/mcp-core'
import type { Subcommand } from './commands/types'
import { commandRegistry, getCommandGroup, getCommandNames, getSubcommand, getSubcommandNames } from './commands'

export type BuiltinMatch = {
  run: Subcommand['run']
  args: string[]
}

export type CommandLevel = CommandMatch & {
  /** Built-in and endpoint commands directly below the matched words, sorted. */
  subcommands: string[]
}

/** Build the endpoint command tree, failing if an endpoint path lands on a built-in command. */
export function buildCliCommandTree(endpoints: EndpointGroups): CommandNode {
  const tree = buildCommandTree(endpoints)
  for (const [name, group] of Object.entries(commandRegistry)) {
    const node = tree.children.get(name)
    if (!node) continue
    if (node.endpoint) {
      throw new Error(`Endpoint ${node.endpoint.path} collides with the built-in command: terros ${name}`)
    }
    for (const subcommand of Object.keys(group.subcommands)) {
      const child = node.children.get(subcommand)
      if (child) {
        throw new Error(
          `Endpoint ${getEndpointPaths(child)[0]} collides with the built-in command: terros ${name} ${subcommand}`
        )
      }
    }
  }
  return tree
}

/** The built-in command named by `words`, if any. Built-ins never need the API schema. */
export function findBuiltin(words: string[]): BuiltinMatch | undefined {
  const [name, subcommand] = words
  if (name === undefined) return undefined
  const group = getCommandGroup(name)
  if (!group) return undefined
  if (subcommand === undefined) return group.run ? { run: group.run, args: [] } : undefined
  const command = getSubcommand(name, subcommand)
  return command ? { run: command.run, args: words.slice(2) } : undefined
}

/** Match `words` against the endpoint tree, listing built-in commands at the levels they share with it. */
export function matchCommand(tree: CommandNode, words: string[]): CommandLevel {
  let match = findCommand(tree, words)
  const [name] = words
  if (match.words.length === 0 && name !== undefined && getCommandGroup(name)) {
    match = { node: { children: new Map() }, words: [name], unmatched: words.slice(1) }
  }

  const subcommands = new Set(getChildCommandNames(match.node))
  if (match.words.length === 0) getCommandNames().forEach((command) => subcommands.add(command))
  if (match.words.length === 1)
    getSubcommandNames(match.words[0] as string).forEach((command) => subcommands.add(command))
  return { ...match, subcommands: [...subcommands].sort() }
}
