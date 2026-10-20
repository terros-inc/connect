import type { Endpoint, EndpointGroups } from './endpoint.ts'

/**
 * One word of the CLI command tree. A node runs `endpoint` when the command stops there, and has `children` for each
 * longer path below it, so `/garden/bed/list` is `garden` → `bed` → `list`.
 */
export type CommandNode = {
  endpoint?: Endpoint
  children: Map<string, CommandNode>
}

/**
 * Two endpoint paths, or an endpoint path and a reserved or built-in command, map to the same CLI command. Unlike a
 * schema that cannot be read, this means the schema itself would hide a command, so callers must never ignore it.
 */
export class CommandCollisionError extends Error {
  name = 'CommandCollisionError'
}

export type CommandMatch = {
  /** Deepest node reached. */
  node: CommandNode
  /** Words that matched, from the root to `node`. */
  words: string[]
  /** Words left over after `node`; empty when every word matched. */
  unmatched: string[]
}

/** Build the CLI command tree from parsed endpoints. Each endpoint's command is its full path. */
export function buildCommandTree(endpoints: EndpointGroups): CommandNode {
  const root: CommandNode = { children: new Map() }
  for (const [group, groupEndpoints] of Object.entries(endpoints)) {
    for (const [alias, endpoint] of Object.entries(groupEndpoints)) {
      const words = [group, ...alias.split(' ').filter((word) => word !== '')]
      let node = root
      for (const word of words) {
        let child = node.children.get(word)
        if (!child) {
          child = { children: new Map() }
          node.children.set(word, child)
        }
        node = child
      }
      if (node.endpoint) {
        throw new CommandCollisionError(
          `Endpoints ${node.endpoint.path} and ${endpoint.path} both map to the command: terros ${words.join(' ')}`
        )
      }
      node.endpoint = endpoint
    }
  }
  return root
}

/** Follow `words` down the tree as far as they match. */
export function findCommand(root: CommandNode, words: string[]): CommandMatch {
  let node = root
  let index = 0
  for (; index < words.length; index++) {
    const child = node.children.get(words[index] as string)
    if (!child) break
    node = child
  }
  return { node, words: words.slice(0, index), unmatched: words.slice(index) }
}

/** Sorted names of the commands directly below `node`. */
export function getChildCommandNames(node: CommandNode): string[] {
  return [...node.children.keys()].sort()
}

/** Paths of every endpoint at or below `node`, sorted. */
export function getEndpointPaths(node: CommandNode): string[] {
  const paths = node.endpoint ? [node.endpoint.path] : []
  for (const child of node.children.values()) paths.push(...getEndpointPaths(child))
  return paths.sort()
}
