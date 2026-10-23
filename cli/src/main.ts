import minimist from 'minimist'
import {
  buildEndpointInput,
  CommandCollisionError,
  DEFAULT_TYPE_DEPTH,
  getEndpointInputParameters,
  type CommandNode,
} from '@terros-inc/mcp-core'
import packageJson from '../package.json'
import {
  formatCommandsHelp,
  formatCommandUsage,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
  REPORT_KPI_HELP,
} from './messages'
import { loadEndpoints } from './loadEndpoints'
import { readInputFile } from './inputFile'
import {
  buildCliCommandTree,
  checkBuiltinCollisions,
  findBuiltin,
  formatBuiltinHelp,
  matchCommand,
  type CommandLevel,
} from './commandTree'
import { commandRegistry, getCommandGroup } from './commands'
import { runApiHistoryQuery } from './apiHistory'
import { buildTerrosClient } from './api/query'

export async function main(argv: string[]): Promise<void> {
  const params = minimist(argv)
  const words = params._.map(String)
  if (words.length === 0) {
    if (params.v === true || params.version === true) {
      console.log(packageJson.version)
      return
    }

    console.log(HELP_PARENT_MESSAGE)
    return
  }

  if (words.at(-1) === 'help') {
    await showHelp(words.slice(0, -1), params.depth)
    return
  }

  const builtin = findBuiltin(commandRegistry, words)
  if (builtin) {
    await checkBuiltinCollisions(loadEndpoints, commandRegistry, words)
    await builtin.run({ params, args: builtin.args })
    return
  }

  const level = await loadCommandLevel(words)
  if (level.unmatched.length > 0) {
    console.error(`Unknown command: terros ${words.join(' ')}`)
    console.log(formatLevelHelp(level))
    process.exitCode = 1
    return
  }

  const endpoint = level.node.endpoint
  if (!endpoint) {
    console.log(formatLevelHelp(level))
    return
  }

  const { params: flags, base } = readInputFile(params)
  const input = buildEndpointInput(endpoint, flags, base)
  const client = buildTerrosClient()
  const response =
    endpoint.path === '/apiHistory/start'
      ? await runApiHistoryQuery(client, input)
      : await client.call(endpoint.path, input)
  console.log(JSON.stringify(response, null, 2))
}

async function loadCommandLevel(words: string[]): Promise<CommandLevel> {
  let tree: CommandNode
  try {
    tree = buildCliCommandTree(await loadEndpoints(), commandRegistry)
  } catch (error) {
    // A built-in group's own subcommands do not need the API schema, so still list them when it cannot be loaded.
    // A colliding schema is different: listing the group from an empty tree would hide the collision.
    const [name] = words
    if (error instanceof CommandCollisionError || name === undefined || !getCommandGroup(name)) throw error
    console.error(error instanceof Error ? error.message : error)
    tree = { children: new Map() }
  }
  return matchCommand(tree, commandRegistry, words)
}

function formatLevelHelp(level: CommandLevel): string {
  if (level.words.length === 0) return formatCommandsHelp(level.subcommands)
  if (level.node.endpoint && level.subcommands.length === 0) return formatCommandUsage(level.words.join(' '))
  return formatSubcommandsHelp(level.words.join(' '), level.subcommands)
}

async function showHelp(words: string[], requestedDepth: unknown): Promise<void> {
  const builtinHelp = formatBuiltinHelp(commandRegistry, words)
  if (builtinHelp !== undefined) {
    await checkBuiltinCollisions(loadEndpoints, commandRegistry, words)
    console.log(builtinHelp)
    return
  }

  const level = await loadCommandLevel(words)
  if (level.unmatched.length > 0) {
    console.error(`Unknown command: terros ${words.join(' ')}`)
    console.log(formatLevelHelp(level))
    process.exitCode = 1
    return
  }

  const endpoint = level.node.endpoint
  if (endpoint) {
    const depth = getHelpDepth(requestedDepth)
    const parameters = getEndpointInputParameters(endpoint, depth)
    console.log(
      formatSubcommandParametersHelp(
        level.words.join(' '),
        undefined,
        parameters,
        endpoint.path === '/report/kpi' ? REPORT_KPI_HELP : endpoint.description,
        true,
        level.subcommands
      )
    )
    return
  }

  console.log(formatLevelHelp(level))
}

function getHelpDepth(requestedDepth: unknown): number {
  if (requestedDepth === undefined) return DEFAULT_TYPE_DEPTH
  if (typeof requestedDepth !== 'number' || !Number.isInteger(requestedDepth) || requestedDepth < 0) {
    throw new Error('--depth must be a non-negative integer')
  }

  return requestedDepth
}
