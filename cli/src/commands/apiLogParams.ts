import type { ParsedArgs } from 'minimist'
import type { EndpointParameter } from '@terros-inc/mcp-core'

export type ApiLogInput = {
  companyId: string
  endpoint?: string
  errorsOnly?: boolean
  since?: string
  limit?: number
}

export const apiLogParameters: EndpointParameter[] = [
  { name: 'companyId', type: 'string', required: true, description: 'Company whose API requests to list' },
  { name: 'endpoint', type: 'string', required: false, description: 'Only requests to this path, e.g. /account/add' },
  {
    name: 'errorsOnly',
    type: 'boolean',
    required: false,
    description: 'Only requests that returned a typed error (stored with status 200)',
  },
  {
    name: 'since',
    type: 'string',
    required: false,
    description: 'Earliest request time (ISO 8601), clipped to the last seven days',
  },
  { name: 'limit', type: 'integer', required: false, description: 'Maximum requests to return, 1-100 (default 25)' },
]

const API_LOG_FLAGS = new Set(apiLogParameters.map((parameter) => parameter.name))

export function parseApiLogParams(params: ParsedArgs): ApiLogInput {
  const unknown = Object.keys(params).filter((name) => name !== '_' && !API_LOG_FLAGS.has(name))
  if (unknown.length > 0) throw new Error(`Unknown parameter(s): ${unknown.map((name) => `--${name}`).join(', ')}`)
  const companyId = params.companyId
  if (typeof companyId !== 'string' || companyId === '') throw new Error('Missing required parameter: --companyId')
  return {
    companyId,
    endpoint: optionalString(params.endpoint, 'endpoint'),
    errorsOnly: optionalBoolean(params.errorsOnly),
    since: optionalString(params.since, 'since'),
    limit: optionalInteger(params.limit, 'limit'),
  }
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') throw new Error(`--${name} must be a non-empty string`)
  return value
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isInteger(number)) throw new Error(`--${name} must be an integer`)
  return number
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  return value === true || value === 'true'
}
