import { parse } from 'yaml'
import { getCommandWords, HELP_WORD } from './util.ts'
import type { OpenAPISchema } from './types.ts'
import type { EndpointGroups, Endpoints } from './endpoint.ts'

export function parseEndpoints(file: string): EndpointGroups {
  const data = parse(file) as OpenAPISchema

  const entries = Object.entries(data.paths)

  const endpoints: EndpointGroups = Object.create(null)
  const pathsByCommand = new Map<string, string>()

  entries.forEach(([path, config]) => {
    const words = getCommandWords(path)
    const [group, ...rest] = words
    if (group === undefined) throw new Error(`Endpoint path has no command: ${path}`)
    if (words.includes(HELP_WORD)) {
      throw new Error(`Endpoint path ${path} uses the reserved command word "${HELP_WORD}"`)
    }

    const command = words.join(' ')
    const existingPath = pathsByCommand.get(command)
    if (existingPath !== undefined) {
      throw new Error(`Endpoints ${existingPath} and ${path} both map to the command: terros ${command}`)
    }
    pathsByCommand.set(command, path)

    const groupEndpoints: Endpoints = (endpoints[group] ??= Object.create(null))

    const schema = config.post.requestBody.content['application/json'].schema

    groupEndpoints[rest.join(' ')] = {
      path,
      description: config.post.description ?? config.post.summary,
      properties: schema,
      components: data.components,
    }
  })

  return endpoints
}
