import minimist from 'minimist'
import {
  buildEndpointInput,
  CommandCollisionError,
  DEFAULT_TYPE_DEPTH,
  getEndpointInputParameters,
  type CommandNode,
  withoutUploadUrls,
} from '@terros-inc/mcp-core'
import packageJson from '../package.json'
import {
  formatCommandsHelp,
  formatCommandUsage,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
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

/** A negative number, in the forms minimist itself reads as a number: `-124.5`, `-3`, `-.5`, `-1e-3`. */
const NEGATIVE_NUMBER = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i

/**
 * Parse the command line, reading a negative number after a long flag as that flag's value. minimist alone reads
 * `--longitude -124.5` as `--longitude` plus the short flags `-1`, `-2` and `-4`, so it is joined into
 * `--longitude=-124.5` first. Short flags and words after `--` are left to minimist unchanged.
 */
export function parseArgv(argv: string[]): minimist.ParsedArgs {
  const joined: string[] = []
  for (const [index, arg] of argv.entries()) {
    if (arg === '--') {
      joined.push(...argv.slice(index))
      break
    }
    const previous = joined.at(-1)
    if (NEGATIVE_NUMBER.test(arg) && previous?.startsWith('--') && previous.length > 2 && !previous.includes('=')) {
      joined[joined.length - 1] = `${previous}=${arg}`
      continue
    }
    joined.push(arg)
  }
  return minimist(joined)
}

export async function main(argv: string[]): Promise<void> {
  const params = parseArgv(argv)
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
  console.log(JSON.stringify(withoutUploadUrls(response), null, 2))
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
        endpoint.description,
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
