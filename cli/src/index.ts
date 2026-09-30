import minimist from 'minimist'
import packageJson from '../package.json'
import {
  formatCommandsHelp,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
} from './messages'
import { DEFAULT_TYPE_DEPTH, getEndpointParameters } from './crud/parameters'
import { buildEndpointInput } from './crud/input'
import type { Endpoint, Endpoints } from './crud/endpoint'
import { loadEndpoints } from './crud'
import { getCommandGroup, getCommandNames, getSubcommand, getSubcommandNames } from './commands'
import { buildTerrosClient } from './api/query'

async function main(): Promise<void> {
  const params = minimist(process.argv.slice(2))
  const commands = params._
  if (commands.length === 0) {
    if (params.v === true || params.version === true) {
      console.log(packageJson.version)
      return
    }

    console.log(HELP_PARENT_MESSAGE)
    return
  }

  const requestedAlias = commands.at(0)
  if (!requestedAlias) {
    console.log(HELP_PARENT_MESSAGE)
    return
  }

  if (commands.at(-1) === 'help') {
    showHelp(commands, requestedAlias, params.depth)
    return
  }

  const commandGroup = getCommandGroup(requestedAlias)
  if (commandGroup) {
    const subcommand = commands.at(1)
    if (!subcommand) {
      console.log(formatSubcommandsHelp(requestedAlias, getSubcommandNames(requestedAlias)))
      return
    }

    const command = getSubcommand(requestedAlias, subcommand)
    if (!command) {
      console.error(`Unknown subcommand: ${requestedAlias} ${subcommand}`)
      console.log(formatSubcommandsHelp(requestedAlias, getSubcommandNames(requestedAlias)))
      process.exitCode = 1
      return
    }

    await command.run({
      params,
      args: commands.slice(2),
    })
    return
  }

  const endpoints = loadEndpoints()
  const endpointGroup = endpoints[requestedAlias]
  if (!endpointGroup) {
    console.error(`Unknown command: ${requestedAlias}`)
    const commandList = [...getCommandNames(), ...Object.keys(endpoints)].sort()
    console.log(formatCommandsHelp(commandList))
    process.exitCode = 1
    return
  }

  const subcommand = commands.at(1)
  const endpoint = getEndpoint(endpointGroup, requestedAlias, subcommand)
  if (subcommand === undefined && !endpoint) {
    console.log(formatSubcommandsHelp(requestedAlias, getEndpointSubcommandNames(endpointGroup, requestedAlias)))
    return
  }

  if (!endpoint) {
    console.error(`Unknown subcommand: ${requestedAlias} ${subcommand}`)
    console.log(formatSubcommandsHelp(requestedAlias, getEndpointSubcommandNames(endpointGroup, requestedAlias)))
    process.exitCode = 1
    return
  }

  const input = buildEndpointInput(endpoint, params)
  const client = buildTerrosClient()
  const response = await client.call(endpoint.path, input)
  console.log(JSON.stringify(response, null, 2))
}

function showHelp(commands: string[], requestedAlias: string, requestedDepth: unknown): void {
  const commandGroup = getCommandGroup(requestedAlias)
  if (commandGroup) {
    const subcommand = commands.at(1)
    if (subcommand && commands.length >= 3 && getSubcommand(requestedAlias, subcommand)) {
      console.log(formatSubcommandParametersHelp(requestedAlias, subcommand, []))
      return
    }

    console.log(formatSubcommandsHelp(requestedAlias, getSubcommandNames(requestedAlias)))
    return
  }

  const endpoints = loadEndpoints()
  const endpoint = endpoints[requestedAlias]
  if (endpoint) {
    const subcommand = commands.length >= 3 ? commands.at(1) : undefined
    const requestedEndpoint = getEndpoint(endpoint, requestedAlias, subcommand)
    if (requestedEndpoint) {
      const depth = getHelpDepth(requestedDepth)
      const parameters = getEndpointParameters(requestedEndpoint.properties, requestedEndpoint.components, depth)
      console.log(
        formatSubcommandParametersHelp(requestedAlias, subcommand, parameters, requestedEndpoint.description, true)
      )
      return
    }

    console.log(formatSubcommandsHelp(requestedAlias, getEndpointSubcommandNames(endpoint, requestedAlias)))
    return
  }

  const commandList = [...getCommandNames(), ...Object.keys(endpoints)].sort()
  console.log(formatCommandsHelp(commandList))
}

function isDirectEndpoint(endpoint: Endpoint | undefined, command: string): endpoint is Endpoint {
  return endpoint?.path === `/${command}`
}

function getEndpoint(endpoints: Endpoints, command: string, subcommand: string | undefined): Endpoint | undefined {
  const endpoint = endpoints[subcommand ?? command]
  const directEndpoint = isDirectEndpoint(endpoint, command)
  if (subcommand === undefined) return directEndpoint ? endpoint : undefined
  return directEndpoint ? undefined : endpoint
}

function getEndpointSubcommandNames(endpoints: Endpoints, command: string): string[] {
  return Object.entries(endpoints)
    .filter(([, endpoint]) => !isDirectEndpoint(endpoint, command))
    .map(([alias]) => alias)
    .sort()
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
