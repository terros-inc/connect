import { readFileSync } from 'node:fs'
import { buildCatalog, getEndpoint, getEndpointSubcommandNames, parseEndpoints } from '@terros-inc/mcp-core'

// CI downloads the public document to cli/terros.yml before tests (`pnpm fetch-openapi`).
const endpoints = parseEndpoints(readFileSync(new URL('../terros.yml', import.meta.url), 'utf8'))

/** Every `terros <command> [subcommand]` the CLI resolves to an API operation, with that operation. */
function getCliCommands() {
  return Object.entries(endpoints).flatMap(([command, group]) => {
    const direct = getEndpoint(group, command)
    const nested = getEndpointSubcommandNames(group, command).map((subcommand) => ({
      args: [command, subcommand],
      endpoint: getEndpoint(group, command, subcommand),
    }))
    return direct ? [{ args: [command], endpoint: direct }, ...nested] : nested
  })
}

it('resolves exactly one CLI command per catalog entry, to the same operation', () => {
  const cliCommands = getCliCommands()
  const commands = new Map(cliCommands.map((command) => [command.endpoint?.path, command]))
  const entries = buildCatalog(endpoints).entries
  expect(entries.length).toBeGreaterThan(0)
  expect(cliCommands).toHaveLength(entries.length)
  expect([...commands.keys()].sort()).toEqual(entries.map((entry) => entry.endpoint.path).sort())
  for (const entry of entries) {
    // `account_get` is `terros account get`; `calendar_event_list` is `terros event list`; `search` is `terros search`.
    const { args, endpoint } = commands.get(entry.endpoint.path)!
    expect(endpoint).toBe(entry.endpoint)
    expect(entry.name.endsWith(args.join('_'))).toBe(true)
  }
})
