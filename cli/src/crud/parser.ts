import { parse } from 'yaml'
import { getPathParts, getTopLevelGroups } from './util'
import type { OpenAPISchema } from './types'
import type { EndpointGroups } from './endpoint'

export function parseEndpoints(file: string): EndpointGroups {
  const data = parse(file) as OpenAPISchema

  const entries = Object.entries(data.paths)
  const topLevelGroups = getTopLevelGroups(Object.keys(data.paths))

  const endpoints: EndpointGroups = {}

  entries.forEach(([path, config]) => {
    const { group, alias } = getPathParts(path, topLevelGroups)
    const existingEndpoints = endpoints[group]
    const existingDirectEndpoint = existingEndpoints?.[group]
    if ((path === `/${alias}` && existingEndpoints) || existingDirectEndpoint?.path === `/${group}`) {
      throw new Error(`Cannot combine direct and grouped endpoints for command: ${group}`)
    }

    endpoints[group] ??= {}
    const duplicate = endpoints[group][alias]
    if (duplicate) {
      throw new Error(`Paths ${duplicate.path} and ${path} both map to command: ${group} ${alias}`)
    }

    const schema = config.post.requestBody.content['application/json'].schema

    endpoints[group][alias] = {
      path,
      description: config.post.description ?? config.post.summary,
      properties: schema,
      components: data.components,
    }
  })

  return endpoints
}
