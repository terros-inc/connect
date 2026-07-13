import type { ParsedArgs } from 'minimist'
import type { Endpoint, EndpointParameter } from './endpoint.ts'

export function buildEndpointInput(endpoint: Endpoint, params: ParsedArgs): object {
  const parsedParams = flattenParsedArgs(params)
  const providedParameterNames = Object.keys(parsedParams)
  const knownParameterNames = new Set(endpoint.parameters.map((parameter) => parameter.name))
  const unknownParameterNames = providedParameterNames.filter((name) => !knownParameterNames.has(name))
  if (unknownParameterNames.length > 0) {
    throw new Error(`Unknown parameter(s): ${unknownParameterNames.map((name) => `--${name}`).join(', ')}`)
  }

  const missingParameters = endpoint.parameters.filter(
    (parameter) => parameter.required && !Object.hasOwn(parsedParams, parameter.name)
  )
  if (missingParameters.length > 0) {
    throw new Error(
      `Missing required parameter(s): ${missingParameters.map((parameter) => `--${parameter.name}`).join(', ')}`
    )
  }

  const input: Record<string, unknown> = {}
  const prefix = getHiddenWrapperPrefix(endpoint)

  for (const parameter of endpoint.parameters) {
    if (!Object.hasOwn(parsedParams, parameter.name)) continue

    const value = parseParameterValue(parsedParams[parameter.name], parameter)
    const path = [...prefix, ...parameter.name.split('.').filter(Boolean)]
    setNestedValue(input, path, value)
  }

  return input
}

function flattenParsedArgs(params: ParsedArgs): Record<string, unknown> {
  const flattened: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (key === '_') continue
    flattenValue(flattened, key, value)
  }

  return flattened
}

function flattenValue(flattened: Record<string, unknown>, prefix: string, value: unknown): void {
  if (isRecord(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      flattenValue(flattened, `${prefix}.${key}`, childValue)
    }
    return
  }

  flattened[prefix] = value
}

function getHiddenWrapperPrefix(endpoint: Endpoint): string[] {
  const schema = endpoint.properties
  if (!('type' in schema) || schema.type !== 'object') return []

  const propertyNames = Object.keys(schema.properties)
  if (propertyNames.length !== 1) return []

  const wrapperName = propertyNames[0]
  if (!wrapperName) return []

  const wrapperSchema = schema.properties[wrapperName]
  if (!wrapperSchema || !('type' in wrapperSchema) || wrapperSchema.type !== 'object') return []

  return [wrapperName]
}

function setNestedValue(input: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) {
    throw new Error('Cannot set a parameter without a name')
  }

  let current = input
  for (const key of path.slice(0, -1)) {
    const existing = current[key]
    if (existing === undefined) {
      const next: Record<string, unknown> = {}
      current[key] = next
      current = next
      continue
    }

    if (!isRecord(existing)) {
      throw new Error(`Parameter path conflict at "${key}"`)
    }

    current = existing
  }

  const leaf = path.at(-1)
  if (!leaf) throw new Error('Cannot set a parameter without a name')

  current[leaf] = value
}

function parseParameterValue(value: unknown, parameter: EndpointParameter): unknown {
  return parseValue(value, parameter.type, parameter.name)
}

function parseValue(value: unknown, type: string, parameterName: string): unknown {
  if (type.endsWith('[]')) {
    return parseArrayValue(value, type.slice(0, -2), parameterName)
  }

  if (type.includes('|')) {
    return parseUnionValue(value, type, parameterName)
  }

  switch (type) {
    case 'string':
      return parseStringValue(value, parameterName)
    case 'integer':
      return parseIntegerValue(value, parameterName)
    case 'number':
      return parseNumberValue(value, parameterName)
    case 'boolean':
      return parseBooleanValue(value, parameterName)
    case 'object':
    case 'unknown':
      return parseJsonValue(value, parameterName)
    default:
      return parseJsonValue(value, parameterName)
  }
}

function parseStringValue(value: unknown, parameterName: string): string {
  if (Array.isArray(value)) {
    throw new Error(`Parameter --${parameterName} expects a single string value`)
  }

  return String(value)
}

function parseIntegerValue(value: unknown, parameterName: string): number {
  const numberValue = parseNumberValue(value, parameterName)
  if (!Number.isInteger(numberValue)) {
    throw new Error(`Parameter --${parameterName} expects an integer`)
  }

  return numberValue
}

function parseNumberValue(value: unknown, parameterName: string): number {
  if (Array.isArray(value)) {
    throw new Error(`Parameter --${parameterName} expects a single number value`)
  }

  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Parameter --${parameterName} expects a number`)
  }

  return numberValue
}

function parseBooleanValue(value: unknown, parameterName: string): boolean {
  if (Array.isArray(value)) {
    throw new Error(`Parameter --${parameterName} expects a single boolean value`)
  }

  if (typeof value === 'boolean') return value

  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (['true', '1', 'yes'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
  }

  throw new Error(`Parameter --${parameterName} expects a boolean`)
}

function parseArrayValue(value: unknown, itemType: string, parameterName: string): unknown[] {
  if (Array.isArray(value)) {
    return value.map((item) => parseValue(item, itemType, parameterName))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      const parsed = parseJsonValue(trimmed, parameterName)
      if (!Array.isArray(parsed)) {
        throw new Error(`Parameter --${parameterName} expects an array`)
      }
      return parsed.map((item) => parseValue(item, itemType, parameterName))
    }

    if (trimmed === '') return []
    return trimmed.split(',').map((item) => parseValue(item, itemType, parameterName))
  }

  return [parseValue(value, itemType, parameterName)]
}

function parseUnionValue(value: unknown, type: string, parameterName: string): unknown {
  const types = type.split('|').map((item) => item.trim())
  const errors: string[] = []

  for (const itemType of types) {
    try {
      return parseValue(value, itemType, parameterName)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(
    `Parameter --${parameterName} does not match any supported type: ${types.join(', ')}. ${errors.at(-1)}`
  )
}

function parseJsonValue(value: unknown, parameterName: string): unknown {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Parameter --${parameterName} expects valid JSON`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
