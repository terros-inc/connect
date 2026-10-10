import type { Endpoint, Endpoints } from './endpoint.ts'

export function isDirectEndpoint(endpoint: Endpoint | undefined, command: string): endpoint is Endpoint {
  return endpoint?.path === `/${command}`
}

export function getEndpoint(endpoints: Endpoints, command: string, subcommand?: string): Endpoint | undefined {
  const endpoint = endpoints[subcommand ?? command]
  const directEndpoint = isDirectEndpoint(endpoint, command)
  if (subcommand === undefined) return directEndpoint ? endpoint : undefined
  return directEndpoint ? undefined : endpoint
}

export function getEndpointSubcommandNames(endpoints: Endpoints, command: string): string[] {
  return Object.entries(endpoints)
    .filter(([, endpoint]) => !isDirectEndpoint(endpoint, command))
    .map(([alias]) => alias)
    .sort()
}
