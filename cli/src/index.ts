import minimist from 'minimist'
import {
  formatCommandsHelp,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
} from './messages'
import { buildEndpointInput } from './crud/input'
import { loadEndpoints } from './crud'
import { getCommandGroup, getCommandNames, getSubcommand, getSubcommandNames } from './commands'
import { buildTerrosClient } from './api/query'

async function main(): Promise<void> {
  const params = minimist(process.argv.slice(2))
  const commands = params._
  if (commands.length === 0) {
    console.log(HELP_PARENT_MESSAGE)
    return
  }

  const requestedAlias = commands.at(0)
  if (!requestedAlias) {
    console.log(HELP_PARENT_MESSAGE)
    return
  }

  if (commands.at(-1) === 'help') {
    showHelp(commands, requestedAlias)
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
  if (!subcommand) {
    console.log(formatSubcommandsHelp(requestedAlias, Object.keys(endpointGroup).sort()))
    return
  }

  const endpoint = endpointGroup[subcommand]
  if (!endpoint) {
    console.error(`Unknown subcommand: ${requestedAlias} ${subcommand}`)
    console.log(formatSubcommandsHelp(requestedAlias, Object.keys(endpointGroup).sort()))
    process.exitCode = 1
    return
  }

  const input = buildEndpointInput(endpoint, params)
  const client = buildTerrosClient()
  const response = await client.call(endpoint.path, input)
  console.log(JSON.stringify(response, null, 2))
}

function showHelp(commands: string[], requestedAlias: string): void {
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
    const subcommand = commands.at(1)
    if (subcommand && commands.length >= 3) {
      const requestedSubcommand = endpoint[subcommand]
      if (requestedSubcommand) {
        console.log(formatSubcommandParametersHelp(requestedAlias, subcommand, requestedSubcommand.parameters))
        return
      }
    }

    console.log(formatSubcommandsHelp(requestedAlias, Object.keys(endpoint).sort()))
    return
  }

  const commandList = [...getCommandNames(), ...Object.keys(endpoints)].sort()
  console.log(formatCommandsHelp(commandList))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
