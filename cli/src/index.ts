import minimist from 'minimist'
import { buildEndpointInput, DEFAULT_TYPE_DEPTH, getEndpointParameters } from '@terros-inc/mcp-core'
import packageJson from '../package.json'
import {
  formatCommandsHelp,
  formatCommandUsage,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
} from './messages'
import { loadEndpoints } from './loadEndpoints'
import { buildCliCommandTree, findBuiltin, matchCommand, type CommandLevel } from './commandTree'
import { commandRegistry, getCommandGroup, getSubcommand } from './commands'
import { runApiHistoryQuery } from './apiHistory'
import { buildTerrosClient } from './api/query'

async function main(): Promise<void> {
  const params = minimist(process.argv.slice(2))
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

  const input = buildEndpointInput(endpoint, params)
  const client = buildTerrosClient()
  const response =
    endpoint.path === '/apiHistory/start'
      ? await runApiHistoryQuery(client, input)
      : await client.call(endpoint.path, input)
  console.log(JSON.stringify(response, null, 2))
}

async function loadCommandLevel(words: string[]): Promise<CommandLevel> {
  return matchCommand(buildCliCommandTree(await loadEndpoints(), commandRegistry), commandRegistry, words)
}

function formatLevelHelp(level: CommandLevel): string {
  if (level.words.length === 0) return formatCommandsHelp(level.subcommands)
  if (level.node.endpoint && level.subcommands.length === 0) return formatCommandUsage(level.words.join(' '))
  return formatSubcommandsHelp(level.words.join(' '), level.subcommands)
}

async function showHelp(words: string[], requestedDepth: unknown): Promise<void> {
  const [name, subcommand] = words
  const commandGroup = name === undefined ? undefined : getCommandGroup(name)
  if (commandGroup && name !== undefined) {
    if (words.length === 1 && commandGroup.run) {
      console.log(formatSubcommandParametersHelp(name, undefined, [], commandGroup.description))
      return
    }
    if (words.length === 2 && subcommand !== undefined && getSubcommand(name, subcommand)) {
      console.log(formatSubcommandParametersHelp(name, subcommand, []))
      return
    }
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
    const parameters = getEndpointParameters(endpoint.properties, endpoint.components, depth)
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.cause ?? error.message) : error)
  process.exitCode = 1
})
