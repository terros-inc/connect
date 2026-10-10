import { readFileSync } from 'node:fs'
import { loadEndpoints as loadCoreEndpoints, type EndpointGroups } from '@terros-inc/mcp-core'
import { loadInternalSchema } from './crud/internal'

export function loadEndpoints(): Promise<EndpointGroups> {
  return loadCoreEndpoints({
    bundled: () => readFileSync(new URL('../terros.yml', import.meta.url), 'utf8'),
    internal: loadInternalSchema,
  })
}
