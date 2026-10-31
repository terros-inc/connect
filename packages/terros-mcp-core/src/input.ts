import { splitTopLevelUnion } from './util.ts'
import { getEndpointParameters, getObjectFields } from './parameters.ts'
import type { Endpoint, EndpointParameter } from './endpoint.ts'

export class UnknownParameterError extends Error {
  name = 'UnknownParameterError'
  readonly parameters: string[]

  constructor(parameters: string[]) {
    super(`Unknown parameter(s): ${parameters.map((name) => `--${name}`).join(', ')}`)
    this.parameters = parameters
  }
}

export type ParsedArgs = { _: string[]; [key: string]: unknown }

/**
 * Parameters the CLI requires although the API schema marks them optional. The API treats an omitted preference
 * `value` as a clear for older mobile clients, so a forgotten `--value` must not wipe a setting: pass `--value null`.
 */
const REQUIRED_PARAMETERS: Record<string, string[]> = { '/preference/update': ['value'] }

/** The endpoint's parameters, with the CLI's own required parameters marked required. */
export function getEndpointInputParameters(endpoint: Endpoint, depth?: number): EndpointParameter[] {
  const required = REQUIRED_PARAMETERS[endpoint.path] ?? []
  return getEndpointParameters(endpoint.properties, endpoint.components, depth).map((parameter) =>
    required.includes(parameter.name) ? { ...parameter, required: true } : parameter
  )
}

/**
 * Build a request body from command-line flags. `base` is a request body read from elsewhere (a file): flags are set
 * on top of it, and a required parameter it already holds need not be passed as a flag.
 */
export function buildEndpointInput(endpoint: Endpoint, params: ParsedArgs, base: Record<string, unknown> = {}): object {
  const parameters = getEndpointInputParameters(endpoint)
  const parsedParams = flattenParsedArgs(params)
  const prefix = getHiddenWrapperPrefix(endpoint)
  const providedParameterNames = Object.keys(parsedParams)
  const knownParameterNames = new Set(parameters.map((parameter) => parameter.name))
  const unknownParameterNames = providedParameterNames.filter((name) => !knownParameterNames.has(name))
  if (unknownParameterNames.length > 0) {
    throw new UnknownParameterError(unknownParameterNames)
  }

  const missingParameters = parameters.filter(
    (parameter) =>
      parameter.required &&
      !Object.hasOwn(parsedParams, parameter.name) &&
      getNestedValue(base, toPath(prefix, parameter.name)) === undefined
  )
  if (missingParameters.length > 0) {
    throw new Error(
      `Missing required parameter(s): ${missingParameters.map((parameter) => `--${parameter.name}`).join(', ')}`
    )
  }

  const input = structuredClone(base)

  for (const parameter of parameters) {
    if (!Object.hasOwn(parsedParams, parameter.name)) continue

    const value = parseParameterValue(parsedParams[parameter.name], parameter)
    setNestedValue(input, toPath(prefix, parameter.name), value)
  }

  return input
}

function toPath(prefix: string[], parameterName: string): string[] {
  return [...prefix, ...parameterName.split('.').filter(Boolean)]
}

function getNestedValue(input: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = input
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
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
  const body = getObjectFields(endpoint.properties, endpoint.components)
  const [wrapperName, ...others] = Object.keys(body?.properties ?? {})
  if (!body || !wrapperName || others.length > 0) return []

  const wrapperSchema = body.properties[wrapperName]
  return wrapperSchema && getObjectFields(wrapperSchema, endpoint.components) ? [wrapperName] : []
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
  const literal = getStringLiteral(type)
  if (literal !== undefined) return parseStringLiteralValue(value, literal, parameterName)

  const members = splitTopLevelUnion(type)
  if (members.length > 1) {
    return parseUnionValue(value, members, parameterName)
  }

  if (type.endsWith('[]')) {
    return parseArrayValue(value, unwrapParens(type.slice(0, -2)), parameterName)
  }

  switch (type) {
    case 'null':
      if (value === null || value === 'null') return null
      throw new Error(`Parameter --${parameterName} expects null`)
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

function unwrapParens(type: string): string {
  return type.startsWith('(') && type.endsWith(')') ? type.slice(1, -1) : type
}

function parseStringValue(value: unknown, parameterName: string): string {
  if (Array.isArray(value)) {
    throw new Error(`Parameter --${parameterName} expects a single string value`)
  }

  // A JSON object inside a list must not become "[object Object]", so a later list-of-objects member can match.
  if (isRecord(value)) {
    throw new Error(`Parameter --${parameterName} expects a string, got an object`)
  }

  // Accept a JSON-quoted string as enum parameters do, so `'"C.example"'` and `C.example` both send the id. The
  // trade-off: a value that should keep its surrounding quotes cannot be passed as a flag (use --inputFile).
  // JSON.parse ignores surrounding whitespace, so ` "C.example"` decodes too; the trim only gates the attempt.
  const text = String(value)
  if (!text.trim().startsWith('"')) return text
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'string' ? parsed : text
  } catch {
    return text
  }
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

/** An enum or const string is printed in the type as a JSON string, e.g. `"weather_data"`. */
function getStringLiteral(type: string): string | undefined {
  if (!type.startsWith('"') || !type.endsWith('"') || type.length < 2) return undefined
  try {
    const literal: unknown = JSON.parse(type)
    return typeof literal === 'string' ? literal : undefined
  } catch {
    return undefined
  }
}

function matchesStringLiteral(value: unknown, literal: string): boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false
  const text = String(value)
  if (text === literal) return true
  if (!text.startsWith('"')) return false
  try {
    return JSON.parse(text) === literal
  } catch {
    return false
  }
}

function parseStringLiteralValue(value: unknown, literal: string, parameterName: string): string {
  if (matchesStringLiteral(value, literal)) return literal
  throw new Error(`Parameter --${parameterName} must be ${literal}, got ${formatReceived(value)}`)
}

function formatReceived(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function parseUnionValue(value: unknown, types: string[], parameterName: string): unknown {
  if (types.includes('null') && (value === null || value === 'null')) return null

  const literals = types.map(getStringLiteral)
  if (literals.every((literal) => literal !== undefined)) {
    const match = literals.find((literal) => matchesStringLiteral(value, literal))
    if (match !== undefined) return match
    throw new Error(`Parameter --${parameterName} must be one of: ${literals.join(', ')}; got ${formatReceived(value)}`)
  }

  const errors: string[] = []

  // Try exact string literals first, so `Warn` matches the literal "Warn" rather than a `string[]` member, then
  // a list or object member when the value already looks like one, then the scalar members in the order the
  // schema lists them, and other lists and objects last.
  const ranked = types
    .map((itemType, index) => ({ itemType, index, rank: unionMemberRank(itemType, value) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
  for (const { itemType } of ranked) {
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

const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean'])

function unionMemberRank(type: string, value: unknown): number {
  if (getStringLiteral(type) !== undefined) return 0
  if (SCALAR_TYPES.has(type)) return 2
  const text = typeof value === 'string' ? value.trim() : undefined
  const isList = type.endsWith('[]')
  if (isList && (Array.isArray(value) || text?.startsWith('['))) return 1
  if (!isList && text?.startsWith('{')) return 1
  return 3
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
