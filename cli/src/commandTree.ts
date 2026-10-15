import {
  buildCommandTree,
  findCommand,
  getChildCommandNames,
  getEndpointPaths,
  type CommandMatch,
  type CommandNode,
  type EndpointGroups,
} from '@terros-inc/mcp-core'
import type { CommandGroup, CommandRegistry, Subcommand } from './commands/types'

export type BuiltinMatch = {
  run: Subcommand['run']
  args: string[]
}

export type CommandLevel = CommandMatch & {
  /** Built-in and endpoint commands directly below the matched words, sorted. */
  subcommands: string[]
}

function getGroup(registry: CommandRegistry, name: string): CommandGroup | undefined {
  return Object.hasOwn(registry, name) ? registry[name] : undefined
}

/** Build the endpoint command tree, failing if an endpoint path lands on a built-in command. */
export function buildCliCommandTree(endpoints: EndpointGroups, registry: CommandRegistry): CommandNode {
  const tree = buildCommandTree(endpoints)
  for (const [name, group] of Object.entries(registry)) {
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
export function findBuiltin(registry: CommandRegistry, words: string[]): BuiltinMatch | undefined {
  const [name, subcommand] = words
  const group = name === undefined ? undefined : getGroup(registry, name)
  if (!group) return undefined
  if (subcommand === undefined) return group.run ? { run: group.run, args: [] } : undefined
  if (!Object.hasOwn(group.subcommands, subcommand)) return undefined
  return { run: (group.subcommands[subcommand] as Subcommand).run, args: words.slice(2) }
}

/** Match `words` against the endpoint tree, listing built-in commands at the levels they share with it. */
export function matchCommand(tree: CommandNode, registry: CommandRegistry, words: string[]): CommandLevel {
  let match = findCommand(tree, words)
  const [name] = words
  const group = name === undefined ? undefined : getGroup(registry, name)
  if (match.words.length === 0 && name !== undefined && group) {
    match = { node: { children: new Map() }, words: [name], unmatched: words.slice(1) }
  }

  const subcommands = new Set(getChildCommandNames(match.node))
  if (match.words.length === 0) Object.keys(registry).forEach((command) => subcommands.add(command))
  if (match.words.length === 1 && group) Object.keys(group.subcommands).forEach((command) => subcommands.add(command))
  return { ...match, subcommands: [...subcommands].sort() }
}
