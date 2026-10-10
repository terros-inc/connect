import type { ParsedArgs } from 'minimist'

export type ApiLogInput = {
  companyId: string
  endpoint?: string
  errorsOnly?: boolean
  since?: string
  limit?: number
}

const API_LOG_FLAGS = new Set(['companyId', 'endpoint', 'errorsOnly', 'since', 'limit'])

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
