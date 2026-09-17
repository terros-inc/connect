import minimist, { type ParsedArgs } from 'minimist'
import packageJson from '../package.json'
import {
  formatCommandsHelp,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
} from './messages'
import { DEFAULT_TYPE_DEPTH, getEndpointParameters } from './crud/parameters'
import { buildEndpointInput } from './crud/input'
import type { Endpoint, EndpointGroups, Endpoints } from './crud/endpoint'
import { loadEndpoints, loadInternalEndpoints } from './crud'
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

  if (requestedAlias === 'internal') {
    const internalEndpoints = loadInternalEndpoints()
    if (hasEndpointGroups(internalEndpoints)) {
      await runInternalCommand(commands, params, internalEndpoints)
      return
    }
  }

  const endpoints = loadEndpoints()
  const endpointGroup = endpoints[requestedAlias]
  if (!endpointGroup) {
    console.error(`Unknown command: ${requestedAlias}`)
    console.log(formatCommandsHelp(getCommandList(endpoints)))
    process.exitCode = 1
    return
  }

  await runEndpointCommand(requestedAlias, requestedAlias, commands.at(1), endpointGroup, params)
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

  if (requestedAlias === 'internal') {
    const internalEndpoints = loadInternalEndpoints()
    if (hasEndpointGroups(internalEndpoints)) {
      showInternalHelp(commands, requestedDepth, internalEndpoints)
      return
    }
  }

  const endpoints = loadEndpoints()
  const endpointGroup = endpoints[requestedAlias]
  if (endpointGroup) {
    const subcommand = commands.length >= 3 ? commands.at(1) : undefined
    showEndpointHelp(requestedAlias, requestedAlias, subcommand, endpointGroup, requestedDepth)
    return
  }

  const commandList = getCommandList(endpoints)
  console.log(formatCommandsHelp(commandList))
}

async function runInternalCommand(commands: string[], params: ParsedArgs, endpoints: EndpointGroups): Promise<void> {
  const requestedGroup = commands.at(1)
  if (!requestedGroup) {
    console.log(formatSubcommandsHelp('internal', Object.keys(endpoints).sort()))
    return
  }

  const endpointGroup = endpoints[requestedGroup]
  if (!endpointGroup) {
    console.error(`Unknown command: internal ${requestedGroup}`)
    console.log(formatSubcommandsHelp('internal', Object.keys(endpoints).sort()))
    process.exitCode = 1
    return
  }

  await runEndpointCommand(`internal ${requestedGroup}`, requestedGroup, commands.at(2), endpointGroup, params)
}

function showInternalHelp(commands: string[], requestedDepth: unknown, endpoints: EndpointGroups): void {
  const requestedGroup = commands.at(1)
  if (!requestedGroup || requestedGroup === 'help') {
    console.log(formatSubcommandsHelp('internal', Object.keys(endpoints).sort()))
    return
  }

  const endpointGroup = endpoints[requestedGroup]
  if (!endpointGroup) {
    console.log(formatSubcommandsHelp('internal', Object.keys(endpoints).sort()))
    return
  }

  const subcommand = commands.length >= 4 ? commands.at(2) : undefined
  showEndpointHelp(`internal ${requestedGroup}`, requestedGroup, subcommand, endpointGroup, requestedDepth)
}

async function runEndpointCommand(
  command: string,
  endpointGroupName: string,
  subcommand: string | undefined,
  endpointGroup: Endpoints,
  params: ParsedArgs
): Promise<void> {
  const endpoint = getEndpoint(endpointGroup, endpointGroupName, subcommand)
  if (subcommand === undefined && !endpoint) {
    console.log(formatSubcommandsHelp(command, getEndpointSubcommandNames(endpointGroup, endpointGroupName)))
    return
  }

  if (!endpoint) {
    console.error(`Unknown subcommand: ${command} ${subcommand}`)
    console.log(formatSubcommandsHelp(command, getEndpointSubcommandNames(endpointGroup, endpointGroupName)))
    process.exitCode = 1
    return
  }

  const input = buildEndpointInput(endpoint, params)
  const client = buildTerrosClient()
  const response = await client.call(endpoint.path, input)
  console.log(JSON.stringify(response, null, 2))
}

function showEndpointHelp(
  command: string,
  endpointGroupName: string,
  subcommand: string | undefined,
  endpointGroup: Endpoints,
  requestedDepth: unknown
): void {
  const endpoint = getEndpoint(endpointGroup, endpointGroupName, subcommand)
  if (!endpoint) {
    console.log(formatSubcommandsHelp(command, getEndpointSubcommandNames(endpointGroup, endpointGroupName)))
    return
  }

  const depth = getHelpDepth(requestedDepth)
  const parameters = getEndpointParameters(endpoint.properties, endpoint.components, depth)
  console.log(formatSubcommandParametersHelp(command, subcommand, parameters, endpoint.description, true))
}

function getCommandList(endpoints: EndpointGroups): string[] {
  const commands = [...getCommandNames(), ...Object.keys(endpoints)]
  if (hasEndpointGroups(loadInternalEndpoints())) commands.push('internal')
  return commands.sort()
}

function hasEndpointGroups(endpoints: EndpointGroups): boolean {
  return Object.keys(endpoints).at(0) !== undefined
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
