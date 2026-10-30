import { splitTopLevelUnion } from './util.ts'
import type { ObjectSchema, Schema } from './types.ts'
import type { EndpointParameter } from './endpoint.ts'

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
  /** Whether a union or `allOf` of objects here is expanded into its fields rather than taken as one JSON value. */
  expandUnion: boolean
}

type ObjectFields = {
  properties: Record<string, Schema>
  required: string[]
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

/** An object schema that is not also a union or `allOf`, which zod-openapi writes as `{ type: 'object', oneOf }`. */
function isPlainObject(schema: Schema): schema is ObjectSchema {
  return 'type' in schema && schema.type === 'object' && !('allOf' in schema) && getVariants(schema) === undefined
}

function getEnumValues(schema: Schema): unknown[] | undefined {
  if ('enum' in schema && schema.enum !== undefined) return schema.enum
  return undefined
}

/** A list of a union needs parentheses: `("a" | "b")[]`, not `"a" | "b"[]`, which reads as a union with a list member. */
function isCompoundType(type: string): boolean {
  return splitTopLevelUnion(type).length > 1
}

function getSchemaType(schema: Schema, components: Components, depth = DEFAULT_TYPE_DEPTH): string {
  if (isRefSchema(schema)) return getSchemaType(resolveSchema(schema, components), components, depth)
  const variants = getVariants(schema)
  if (variants) return getVariantTypes(variants, components, depth).join(' | ')

  const enumValues = getEnumValues(schema)
  if (enumValues && enumValues.length > 0) return enumValues.map((value) => JSON.stringify(value)).join(' | ')

  if ('const' in schema) return JSON.stringify(schema.const)

  if ('type' in schema) {
    if (schema.type === 'array') {
      if ('prefixItems' in schema) {
        return `[${schema.prefixItems.map((item) => getSchemaType(item, components, depth)).join(', ')}]`
      }

      if (!schema.items) return 'unknown[]'
      const itemType = getSchemaType(schema.items, components, depth)
      return isCompoundType(itemType) ? `(${itemType})[]` : `${itemType}[]`
    }
    if (schema.type === 'object') {
      if (depth <= 0) return 'object'
      if (schema.properties) return formatObjectShape(schema, components, depth)
      if (schema.additionalProperties)
        return `{ [key: string]: ${getSchemaType(schema.additionalProperties, components, depth - 1)} }`
      return 'object'
    }
    return schema.type
  }

  return 'unknown'
}

/** A union such as user, team, or company ID resolves to `string` three times; print it once. */
function getVariantTypes(variants: Schema[], components: Components, depth: number): string[] {
  return [...new Set(variants.map((item) => getSchemaType(item, components, depth)))]
}

function formatObjectShape(schema: ObjectSchema, components: Components, depth: number): string {
  if (!schema.properties) return '{}'
  const properties = Object.entries(schema.properties).map(([name, property]) => {
    const suffix = schema.required?.includes(name) ? '' : '?'
    return `${name}${suffix}: ${getSchemaType(property, components, depth - 1)}`
  })

  return properties.length > 0 ? `{ ${properties.join(', ')} }` : '{}'
}

export function resolveSchema(schema: Schema, components: Components, seen = new Set<string>()): Schema {
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

/**
 * The description nearest the property: a description written beside a `$ref` wins over the one on the schema it
 * points to, at every hop of a ref chain.
 */
function getSchemaDescription(schema: Schema, components: Components): string | undefined {
  const seen = new Set<string>()
  let current: Schema | undefined = schema
  while (current) {
    if (current.description) return current.description
    if (!isRefSchema(current) || seen.has(current.$ref)) return undefined
    seen.add(current.$ref)
    current = components.schemas[current.$ref.replace(/^#\/components\/schemas\//, '')]
  }
  return undefined
}

function flattenSchema(schema: Schema, context: FlattenContext): EndpointParameter[] {
  const resolved = resolveSchema(schema, context.components)
  const fields =
    isPlainObject(resolved) || context.expandUnion ? getObjectFields(resolved, context.components) : undefined

  if (fields) {
    // Only the request body and the one object it wraps are expanded: a union among other fields keeps taking JSON,
    // so existing `--grouping '{...}'` calls still work.
    const isWrapper = context.path.length === 0 && Object.keys(fields.properties).length === 1
    return Object.entries(fields.properties).flatMap(([name, childSchema]) =>
      flattenSchema(childSchema, {
        components: context.components,
        path: [...context.path, name],
        required: context.required && fields.required.includes(name),
        depth: context.depth,
        expandUnion: isWrapper,
      })
    )
  }

  const description = getSchemaDescription(schema, context.components)
  return [
    {
      name: context.path.join('.'),
      type: getSchemaType(resolved, context.components, context.depth),
      required: context.required,
      ...(description ? { description } : {}),
    },
  ]
}

/**
 * The fields of an object schema. An `allOf` has every member's fields, and object keywords beside it count as one
 * more member. A union of objects has every variant's fields, required only when every variant requires them, so a
 * command offers all of them and the API rejects a combination no variant allows. A field whose schema differs between
 * members keeps the members' keyword: it must match all of an `allOf`'s schemas, or any of a union's.
 */
export function getObjectFields(schema: Schema, components: Components): ObjectFields | undefined {
  const resolved = resolveSchema(schema, components)
  const allOf = 'allOf' in resolved ? resolved.allOf : undefined
  const members = allOf ?? getVariants(resolved)
  const own =
    'properties' in resolved && resolved.properties
      ? { properties: resolved.properties, required: resolved.required ?? [] }
      : undefined
  if (!members) return isPlainObject(resolved) ? own : undefined
  if (members.length === 0) return undefined

  const memberFields: ObjectFields[] = []
  for (const member of members) {
    // An `allOf` member that only says "an object" adds no fields; in a union it would allow any object, so it cannot.
    const fields =
      getObjectFields(member, components) ?? (allOf && isAnyObject(member, components) ? NO_FIELDS : undefined)
    if (!fields) return undefined
    memberFields.push(fields)
  }

  const fields = mergeFields(memberFields, allOf ? 'allOf' : 'oneOf')
  return own ? mergeFields([own, fields], 'allOf') : fields
}

const NO_FIELDS: ObjectFields = { properties: {}, required: [] }

function isAnyObject(schema: Schema, components: Components): boolean {
  const resolved = resolveSchema(schema, components)
  return isPlainObject(resolved) && !resolved.properties && !resolved.additionalProperties
}

function mergeFields(members: ObjectFields[], keyword: 'allOf' | 'oneOf'): ObjectFields {
  const schemasByName = new Map<string, Schema[]>()
  for (const fields of members) {
    for (const [name, fieldSchema] of Object.entries(fields.properties)) {
      const schemas = schemasByName.get(name) ?? []
      if (!schemas.some((known) => JSON.stringify(known) === JSON.stringify(fieldSchema))) schemas.push(fieldSchema)
      schemasByName.set(name, schemas)
    }
  }

  const names = [...schemasByName.keys()]
  const isRequired = (name: string) => (fields: ObjectFields) => fields.required.includes(name)
  return {
    properties: Object.fromEntries(
      [...schemasByName].map(([name, schemas]) => [
        name,
        schemas.length === 1 ? schemas[0]! : keyword === 'allOf' ? { allOf: schemas } : { oneOf: schemas },
      ])
    ),
    required: names.filter((name) =>
      keyword === 'allOf' ? members.some(isRequired(name)) : members.every(isRequired(name))
    ),
  }
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
      expandUnion: true,
    })
  )
}
