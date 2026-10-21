import { parse } from 'yaml'
import { parseEndpoints } from '@terros-inc/mcp-core'
import { buildCliCommandTree } from './commandTree'
import type { CommandRegistry } from './commands/types'

/** Where the OpenAPI document lists the built-in commands its own lint keeps endpoint paths away from. */
export const BUILTINS_EXTENSION = 'x-terros-cli-builtins'

/** Every built-in command by its words: `auth login`, or `mcp` for a group that runs on its own. */
export function getBuiltinCommands(registry: CommandRegistry): string[] {
  return Object.entries(registry).flatMap(([name, group]) => [
    ...(group.run ? [name] : []),
    ...Object.keys(group.subcommands).map((subcommand) => `${name} ${subcommand}`),
  ])
}

/**
 * Fail unless `document`, the schema a release bundles, builds a valid command tree beside the built-ins, and lists
 * every built-in under `x-terros-cli-builtins`. The first keeps a release from shipping a schema that fails its
 * commands at runtime (`auth login` included, see `checkBuiltinCollisions`). The second keeps the two lists from
 * drifting: the document's lint only rejects paths that land on the built-ins it lists, so a new built-in must be
 * listed there before a release adds it.
 */
export function checkReleaseSchema(document: string, registry: CommandRegistry): void {
  buildCliCommandTree(parseEndpoints(document), registry)
  const listed: unknown = (parse(document) as Record<string, unknown>)[BUILTINS_EXTENSION]
  const reserved = new Set(Array.isArray(listed) ? listed : [])
  const missing = getBuiltinCommands(registry).filter((command) => !reserved.has(command))
  if (missing.length > 0) {
    throw new Error(
      `The OpenAPI document does not list ${missing.map((command) => `terros ${command}`).join(', ')} under ` +
        `${BUILTINS_EXTENSION}, so nothing stops an endpoint path from landing on them. ` +
        'Add them to the list the document publishes, and deploy it, before releasing the CLI.'
    )
  }
}
