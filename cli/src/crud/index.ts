import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseEndpoints } from './parser'
import { loadInternalSchema } from './internal'
import type { EndpointGroups } from './endpoint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function loadEndpoints(): Promise<EndpointGroups> {
  const internal = await loadInternalSchema()
  const file = internal ?? readFileSync(resolve(__dirname, '../terros.yml'), 'utf-8')
  return parseEndpoints(file)
}
