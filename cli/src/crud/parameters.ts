import type { ObjectSchema, Schema } from './types'
import type { EndpointParameter } from './endpoint'

export type Components = {
  schemas: {
    [name: string]: Schema
  }
}

export const DEFAULT_TYPE_DEPTH = 1

type FlattenContext = {
  components: Components
  path: string[]
  required: boolean
  depth: number
}

function isRefSchema(schema: Schema): schema is Schema & { $ref: string } {
  return '$ref' in schema
}

function isAnyOfSchema(schema: Schema): schema is Schema & { anyOf: Schema[] } {
  return 'anyOf' in schema
}

function getVariants(schema: Schema): Schema[] | undefined {
  if ('oneOf' in schema) return schema.oneOf
  if (isAnyOfSchema(schema)) return schema.anyOf
  return undefined
}

function getEnumValues(schema: Schema): unknown[] | undefined {
  if ('enum' in schema && schema.enum !== undefined) return schema.enum
  return undefined
}

function isCompoundSchema(schema: Schema, components: Components): boolean {
  const resolved = resolveSchema(schema, components)
  const variants = getVariants(resolved)
  if (variants) return variants.length > 1

  const enumValues = getEnumValues(resolved)
  return (enumValues?.length ?? 0) > 1
}

function getSchemaType(schema: Schema, components: Components, depth = DEFAULT_TYPE_DEPTH): string {
  if (isRefSchema(schema)) return getSchemaType(resolveSchema(schema, components), components, depth)
  const variants = getVariants(schema)
  if (variants) return variants.map((item) => getSchemaType(item, components, depth)).join(' | ')

  const enumValues = getEnumValues(schema)
  if (enumValues) return enumValues.map((value) => JSON.stringify(value)).join(' | ')

  if ('type' in schema) {
    if (schema.type === 'array') {
      if ('prefixItems' in schema) {
        return `[${schema.prefixItems.map((item) => getSchemaType(item, components, depth)).join(', ')}]`
      }

      const itemType = getSchemaType(schema.items, components, depth)
      return isCompoundSchema(schema.items, components) ? `(${itemType})[]` : `${itemType}[]`
    }
    if (schema.type === 'object') {
      if (depth <= 0 || !schema.properties) return 'object'
      return formatObjectShape(schema, components, depth)
    }
    return schema.type
  }

  return 'unknown'
}

function formatObjectShape(schema: ObjectSchema, components: Components, depth: number): string {
  const properties = Object.entries(schema.properties).map(([name, property]) => {
    const suffix = schema.required?.includes(name) ? '' : '?'
    return `${name}${suffix}: ${getSchemaType(property, components, depth - 1)}`
  })

  return properties.length > 0 ? `{ ${properties.join(', ')} }` : '{}'
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
        depth: context.depth,
      })
    })
  }

  return [
    {
      name: context.path.join('.'),
      type: getSchemaType(resolved, context.components, context.depth),
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

export function getEndpointParameters(
  schema: Schema,
  components: Components,
  depth = DEFAULT_TYPE_DEPTH
): EndpointParameter[] {
  return hideSingleObjectWrapper(
    flattenSchema(schema, {
      components,
      path: [],
      required: true,
      depth,
    })
  )
}
