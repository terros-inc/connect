import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { getPathParts } from './util.ts'
import type { OpenAPISchema } from './types.ts'
import { getEndpointParameters } from './parameters.ts'
import type { EndpointGroups } from './endpoint.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function loadEndpoints(): EndpointGroups {
  const file = readFileSync(resolve(__dirname, '../../terros.yml'), 'utf-8')

  const data = parse(file) as OpenAPISchema

  const entries = Object.entries(data.paths)

  const endpoints: EndpointGroups = {}

  entries.forEach(([path, config]) => {
    const { group, alias } = getPathParts(path)

    endpoints[group] ??= {}

    const schema = config.post.requestBody.content['application/json'].schema

    endpoints[group][alias] = {
      path,
      properties: schema,
      parameters: getEndpointParameters(schema, data.components),
    }
  })

  return endpoints
}
