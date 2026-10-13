import type { Schema } from './types.ts'
import type { Endpoint } from './endpoint.ts'

export function getInputSchema(endpoint: Endpoint): Record<string, unknown> {
  const schemas: Record<string, Schema> = {}

  function collect(value: unknown): void {
    if (value === null || typeof value !== 'object') return
    if ('$ref' in value && typeof value.$ref === 'string') {
      const prefix = '#/components/schemas/'
      if (!value.$ref.startsWith(prefix)) throw new Error(`Unsupported schema reference: ${value.$ref}`)
      const name = value.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~')
      if (!Object.hasOwn(schemas, name)) {
        const schema = endpoint.components?.schemas?.[name]
        if (!schema) throw new Error(`Unknown schema reference: ${value.$ref}`)
        Object.defineProperty(schemas, name, { value: schema, enumerable: true })
        collect(schema)
      }
    }
    for (const child of Object.values(value)) collect(child)
  }

  collect(endpoint.properties)
  return { ...endpoint.properties, components: { schemas } }
}
