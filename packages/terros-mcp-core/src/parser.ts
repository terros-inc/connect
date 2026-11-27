import { parse } from 'yaml'
import { getCommandWords, HELP_WORD } from './util.ts'
import type { OpenAPISchema } from './types.ts'
import type { EndpointExample, EndpointGroups, Endpoints } from './endpoint.ts'
import { CommandCollisionError } from './command.ts'

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
      throw new CommandCollisionError(`Endpoint path ${path} uses the reserved command word "${HELP_WORD}"`)
    }

    const command = words.join(' ')
    const existingPath = pathsByCommand.get(command)
    if (existingPath !== undefined) {
      throw new CommandCollisionError(
        `Endpoints ${existingPath} and ${path} both map to the command: terros ${command}`
      )
    }
    pathsByCommand.set(command, path)

    const groupEndpoints: Endpoints = (endpoints[group] ??= Object.create(null))

    const { schema, example, examples } = config.post.requestBody.content['application/json']

    groupEndpoints[rest.join(' ')] = {
      path,
      description: config.post.description ?? config.post.summary,
      examples: toExamples(example, examples),
      properties: schema,
      components: data.components,
    }
  })

  return endpoints
}

/** The single `example`, else each named example that has a value: an operation can show both calling modes. */
function toExamples(example: unknown, examples: { [name: string]: { value?: unknown } } = {}): EndpointExample[] {
  if (example !== undefined) return [{ value: example }]
  return Object.entries(examples)
    .filter(([, named]) => named.value !== undefined)
    .map(([name, named]) => ({ name, value: named.value }))
}
