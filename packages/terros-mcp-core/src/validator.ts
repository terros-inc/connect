import { fromJsonSchema, type StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { getInputSchema } from './schema.ts'
import type { Endpoint } from './endpoint.ts'

export type InputSchema = StandardSchemaWithJSON<Record<string, unknown>, Record<string, unknown>>

/**
 * Compiling a validator is the slowest part of building a server (about 750 ms for the 87 public operations), so each
 * endpoint's validator is compiled once and shared by every server built from the same loaded endpoints.
 */
const inputSchemas = new WeakMap<Endpoint, InputSchema>()

export function getStandardInputSchema(endpoint: Endpoint): InputSchema {
  let schema = inputSchemas.get(endpoint)
  if (!schema) {
    schema = fromJsonSchema<Record<string, unknown>>(getInputSchema(endpoint))
    inputSchemas.set(endpoint, schema)
  }
  return schema
}

/** Validate input with the same validator the per-endpoint tools use. Returns the issues, if any. */
export function validateEndpointInput(endpoint: Endpoint, input: unknown): string | undefined {
  const result = getStandardInputSchema(endpoint)['~standard'].validate(input)
  if (result instanceof Promise) throw new Error('Asynchronous schema validation is not supported')
  return result.issues?.map((issue) => issue.message).join('; ')
}
