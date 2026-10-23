import { readFileSync } from 'node:fs'
import { loadEndpoints as loadCoreEndpoints, type EndpointGroups } from '@terros-inc/mcp-core'
import { ratioReadEndpoints } from './crud/ratio'
import { loadInternalSchema } from './crud/internal'

export async function loadEndpoints(): Promise<EndpointGroups> {
  const endpoints = await loadCoreEndpoints({
    bundled: () => readFileSync(new URL('../terros.yml', import.meta.url), 'utf8'),
    internal: loadInternalSchema,
  })

  const ratioEndpoints = (endpoints.ratio ??= Object.create(null))
  for (const [name, endpoint] of Object.entries(ratioReadEndpoints)) {
    if (!Object.hasOwn(ratioEndpoints, name)) ratioEndpoints[name] = endpoint
  }
  return endpoints
}
