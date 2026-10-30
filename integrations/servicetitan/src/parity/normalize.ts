import type { StRequest, TerrosWrite } from './types.ts'

export type RawCall = {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

export function sortedQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {}
  const entries = [...url.searchParams.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  for (const [key, value] of entries) query[key] = value
  return query
}

export function readBody(body: unknown): unknown {
  if (typeof body !== 'string' || body.length === 0) return null
  return JSON.parse(body) as unknown
}

// Same normalization as the legacy harness: symbolic ids for rows created in this run, sorted query
// params, undefined fields dropped, and consecutive identical calls collapsed to a retries count.
export function normalizeCalls(calls: RawCall[], aliases: Map<number, string>): StRequest[] {
  const rewritten = calls.map((call) => ({
    method: call.method,
    path: rewritePath(call.path, aliases),
    query: rewriteQuery(call.query, aliases),
    body: rewriteValue(call.body, aliases),
  }))
  return collapseRetries(rewritten)
}

export function normalizeWrites(writes: TerrosWrite[], aliases: Map<number, string>): TerrosWrite[] {
  return writes.map((write) => ({ ...write, value: rewriteString(write.value, aliases) }))
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort((left, right) => left.localeCompare(right))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameRequest(left: StRequest, right: StRequest): boolean {
  return stableJson(withoutRetries(left)) === stableJson(withoutRetries(right))
}

function rewriteQuery(query: Record<string, string>, aliases: Map<number, string>): Record<string, string> {
  const rewritten: Record<string, string> = {}
  for (const key of Object.keys(query).sort((left, right) => left.localeCompare(right))) {
    const value = query[key]
    if (value === undefined) continue
    rewritten[key] = value
      .split(',')
      .map((part) => rewriteString(part, aliases))
      .join(',')
  }
  return rewritten
}

function rewritePath(path: string, aliases: Map<number, string>): string {
  return path
    .split('/')
    .map((part) => rewriteString(part, aliases))
    .join('/')
}

function rewriteValue(value: unknown, aliases: Map<number, string>): unknown {
  if (typeof value === 'number') return aliases.get(value) ?? value
  if (typeof value === 'string') return rewriteString(value, aliases)
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, aliases))
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue
      record[key] = rewriteValue(nested, aliases)
    }
    return record
  }
  return value
}

function rewriteString(value: string, aliases: Map<number, string>): string {
  return value
    .split(/(\d+)/)
    .map((part) => {
      if (!/^\d+$/.test(part)) return part
      return aliases.get(Number(part)) ?? part
    })
    .join('')
}

function collapseRetries(requests: StRequest[]): StRequest[] {
  const collapsed: StRequest[] = []
  for (const request of requests) {
    const previous = collapsed.at(-1)
    if (previous && sameRequest(previous, request)) {
      previous.retries = (previous.retries ?? 0) + 1
      continue
    }
    collapsed.push({ ...request })
  }
  return collapsed
}

function withoutRetries(request: StRequest): StRequest {
  return { method: request.method, path: request.path, query: request.query, body: request.body }
}
