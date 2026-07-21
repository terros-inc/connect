import type { Schema } from './types'
import type { EndpointParameter } from './endpoint'

type Components = {
  schemas: {
    [name: string]: Schema
  }
}

type FlattenContext = {
  components: Components
  path: string[]
  required: boolean
}

function isRefSchema(schema: Schema): schema is Schema & { $ref: string } {
  return '$ref' in schema
}

function isAnyOfSchema(schema: Schema): schema is Schema & { anyOf: Schema[] } {
  return 'anyOf' in schema
}

function getSchemaType(schema: Schema, components: Components): string {
  if (isRefSchema(schema)) return getSchemaType(resolveSchema(schema, components), components)
  if ('oneOf' in schema) return schema.oneOf.map((item) => getSchemaType(item, components)).join(' | ')
  if (isAnyOfSchema(schema)) return schema.anyOf.map((item) => getSchemaType(item, components)).join(' | ')
  if ('type' in schema) {
    if (schema.type === 'array') return `${getSchemaType(schema.items, components)}[]`
    return schema.type
  }

  return 'unknown'
}

function resolveSchema(schema: Schema, components: Components, seen = new Set<string>()): Schema {
  if (!isRefSchema(schema)) return schema

  const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/)
  if (!match) throw new Error(`Unsupported schema ref: ${schema.$ref}`)

  const schemaName = match[1]
  if (!schemaName) throw new Error(`Unsupported schema ref: ${schema.$ref}`)
  if (seen.has(schemaName)) throw new Error(`Circular schema ref: ${schema.$ref}`)

  const resolved = components.schemas[schemaName]
  if (!resolved) throw new Error(`Unknown schema ref: ${schema.$ref}`)

  seen.add(schemaName)
  return resolveSchema(resolved, components, seen)
}

function flattenSchema(schema: Schema, context: FlattenContext): EndpointParameter[] {
  const resolved = resolveSchema(schema, context.components)

  if ('type' in resolved && resolved.type === 'object' && resolved.properties) {
    return Object.entries(resolved.properties).flatMap(([name, childSchema]) => {
      const required = resolved.required?.includes(name) ?? false
      return flattenSchema(childSchema, {
        components: context.components,
        path: [...context.path, name],
        required: context.required && required,
      })
    })
  }

  return [
    {
      name: context.path.join('.'),
      type: getSchemaType(resolved, context.components),
      required: context.required,
      ...((schema.description ?? resolved.description)
        ? { description: schema.description ?? resolved.description }
        : {}),
    },
  ]
}

function hideSingleObjectWrapper(parameters: EndpointParameter[]): EndpointParameter[] {
  const wrapperNames = new Set(parameters.map((parameter) => parameter.name.split('.')[0]))
  if (wrapperNames.size !== 1) return parameters

  const wrapperName = [...wrapperNames][0]
  if (!wrapperName) return parameters

  return parameters.map((parameter) => ({
    ...parameter,
    name: parameter.name.startsWith(`${wrapperName}.`) ? parameter.name.slice(wrapperName.length + 1) : parameter.name,
  }))
}

export function getEndpointParameters(schema: Schema, components: Components): EndpointParameter[] {
  return hideSingleObjectWrapper(
    flattenSchema(schema, {
      components,
      path: [],
      required: true,
    })
  )
}
