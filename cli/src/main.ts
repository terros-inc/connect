import minimist from 'minimist'
import {
  buildEndpointInput,
  CommandCollisionError,
  DEFAULT_TYPE_DEPTH,
  getEndpointInputParameters,
  type EndpointGroups,
  type CommandNode,
} from '@terros-inc/mcp-core'
import packageJson from '../package.json'
import {
  formatCommandsHelp,
  formatCommandUsage,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
} from './messages'
import { loadEndpoints, loadEndpointsAfterRefresh } from './loadEndpoints'
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
import { clearOpenApiCache } from './cache'
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
    if (!(words[0] === 'api' && words[1] === 'refresh')) {
      await checkBuiltinCollisions(loadEndpoints, commandRegistry, words)
    }
    await builtin.run({ params, args: builtin.args })
    return
  }

  let { level, refreshStatus } = await loadCommandLevelWithRefresh(words)
  if (level.unmatched.length > 0) {
    console.error(unknownCommandMessage(words, refreshStatus))
    console.log(formatLevelHelp(level))
    process.exitCode = 1
    return
  }

  let endpoint = level.node.endpoint
  if (!endpoint) {
    console.log(formatLevelHelp(level))
    return
  }

  const { params: flags, base } = readInputFile(params)
  let input: object
  try {
    input = buildEndpointInput(endpoint, flags, base)
  } catch (error) {
    if (!isUnknownParameterError(error) || refreshStatus !== undefined) throw error

    await clearOpenApiCache()
    const refreshed = await loadEndpointsAfterRefresh()
    refreshStatus = refreshed.internalSchemaStatus
    level = await loadCommandLevel(words, Promise.resolve(refreshed.endpoints))
    if (level.unmatched.length > 0 || !level.node.endpoint) {
      console.error(unknownCommandMessage(words, refreshStatus))
      console.log(formatLevelHelp(level))
      process.exitCode = 1
      return
    }

    endpoint = level.node.endpoint
    try {
      input = buildEndpointInput(endpoint, flags, base)
    } catch (retryError) {
      if (!isUnknownParameterError(retryError)) throw retryError
      console.error(unknownParameterMessage(retryError, refreshStatus))
      process.exitCode = 1
      return
    }
  }
  const client = buildTerrosClient()
  const response =
    endpoint.path === '/apiHistory/start'
      ? await runApiHistoryQuery(client, input)
      : await client.call(endpoint.path, input)
  console.log(JSON.stringify(response, null, 2))
}

async function loadCommandLevel(
  words: string[],
  endpoints: Promise<EndpointGroups> = loadEndpoints()
): Promise<CommandLevel> {
  let tree: CommandNode
  try {
    tree = buildCliCommandTree(await endpoints, commandRegistry)
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

async function loadCommandLevelWithRefresh(words: string[]): Promise<{
  level: CommandLevel
  refreshStatus?: 'available' | 'unavailable' | 'failed'
}> {
  const level = await loadCommandLevel(words)
  if (level.unmatched.length === 0 || isLikelyBuiltinTypo(words)) return { level }

  await clearOpenApiCache()
  const refreshed = await loadEndpointsAfterRefresh()
  return {
    level: await loadCommandLevel(words, Promise.resolve(refreshed.endpoints)),
    refreshStatus: refreshed.internalSchemaStatus,
  }
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

  const { level, refreshStatus } = await loadCommandLevelWithRefresh(words)
  if (level.unmatched.length > 0) {
    console.error(unknownCommandMessage(words, refreshStatus))
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

function unknownCommandMessage(words: string[], refreshStatus?: 'available' | 'unavailable' | 'failed'): string {
  if (isLikelyBuiltinTypo(words)) {
    return `Unknown built-in command: terros ${words.join(' ')}. Check the built-in command names above.`
  }
  if (refreshStatus === 'available') {
    return `Unknown command: terros ${words.join(' ')}. The refreshed API schema does not include it; check whether the endpoint is deployed and available to your account.`
  }
  return `Unknown command: terros ${words.join(' ')}. Update the CLI with \`npm install -g @terros-inc/cli\` and retry.`
}

function unknownParameterMessage(error: unknown, refreshStatus?: 'available' | 'unavailable' | 'failed'): string {
  const message = error instanceof Error ? error.message : String(error)
  return refreshStatus === 'available'
    ? `${message}. The refreshed API schema still does not include this parameter; check whether it is supported for your account.`
    : `${message}. Update the CLI with \`npm install -g @terros-inc/cli\` and retry.`
}

function isUnknownParameterError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unknown parameter(s):')
}

function isLikelyBuiltinTypo(words: string[]): boolean {
  const group = getCommandGroup(words[0] ?? '')
  const candidate = words[1]
  if (!group || !candidate || Object.hasOwn(group.subcommands, candidate)) return false
  return Object.keys(group.subcommands).some((name) => isOneEditAway(candidate, name))
}

function isOneEditAway(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let left = 0
  let right = 0
  let edits = 0
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) {
      left++
      right++
    } else {
      if (++edits > 1) return false
      if (a.length > b.length) left++
      else if (b.length > a.length) right++
      else {
        left++
        right++
      }
    }
  }
  return edits + Number(left < a.length || right < b.length) <= 1
}

function getHelpDepth(requestedDepth: unknown): number {
  if (requestedDepth === undefined) return DEFAULT_TYPE_DEPTH
  if (typeof requestedDepth !== 'number' || !Number.isInteger(requestedDepth) || requestedDepth < 0) {
    throw new Error('--depth must be a non-negative integer')
  }

  return requestedDepth
}
