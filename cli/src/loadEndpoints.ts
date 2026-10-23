import { readFileSync } from 'node:fs'
import { loadEndpoints as loadCoreEndpoints, type EndpointGroups } from '@terros-inc/mcp-core'
import { loadInternalSchema, loadInternalSchemaWithStatus } from './crud/internal'

function bundled(): string {
  return readFileSync(new URL('../terros.yml', import.meta.url), 'utf8')
}

export function loadEndpoints(): Promise<EndpointGroups> {
  return loadCoreEndpoints({
    bundled,
    internal: loadInternalSchema,
  })
}

export async function loadEndpointsAfterRefresh(): Promise<{
  endpoints: EndpointGroups
  internalSchemaStatus: 'available' | 'unavailable' | 'failed'
}> {
  const internal = await loadInternalSchemaWithStatus()
  const endpoints = await loadCoreEndpoints({ bundled, internal: () => internal.schema })
  return { endpoints, internalSchemaStatus: internal.status }
}
