import type { Endpoint, EndpointGroups } from './endpoint.ts'

/**
 * Fallback for operations without `x-terros-readOnly` / `x-terros-destructive` in the OpenAPI document.
 * Every route is a POST, so the last route segment is the only hint. Unknown operations count as write, not destructive.
 */
const READ_VERBS = new Set(['get', 'list', 'search', 'check', 'match', 'query', 'profile', 'timeslots'])
const READ_PREFIXES = ['report/']
const DESTRUCTIVE_VERBS = new Set(['remove', 'delete', 'rollback', 'bulk'])

export type CatalogEntry = {
  /** MCP tool name, e.g. `account_get`. */
  name: string
  /** API route without a leading slash, e.g. `account/get`. */
  route: string
  /** Domain the operation belongs to, from its first OpenAPI tag, e.g. `calendar`. */
  toolset: string
  /** One-line description for compact listings. */
  summary: string
  readOnly: boolean
  /** May delete or overwrite data in a way that is hard to undo. Never true for a read-only operation. */
  destructive: boolean
  endpoint: Endpoint
}

export type Catalog = {
  entries: CatalogEntry[]
  find(name: string): CatalogEntry | undefined
}

export type CatalogOptions = {
  /** Only include operations in these toolsets. All toolsets when omitted. */
  toolsets?: string[]
}

/** Build the operation catalog that every tool mode is generated from. */
export function buildCatalog(endpoints: EndpointGroups, options: CatalogOptions = {}): Catalog {
  const allEntries = Object.entries(endpoints).flatMap(([group, groupEndpoints]) =>
    Object.values(groupEndpoints).map((endpoint) => buildEntry(endpoint, group))
  )
  const enabled = options.toolsets ? getEnabledToolsets(allEntries, options.toolsets) : undefined
  const entries = enabled ? allEntries.filter((entry) => enabled.has(entry.toolset)) : allEntries
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  return { entries, find: (name) => byName.get(name) }
}

/** Every toolset name in the catalog, sorted. */
export function getToolsetNames(catalog: Catalog): string[] {
  return [...new Set(catalog.entries.map((entry) => entry.toolset))].sort()
}

function getEnabledToolsets(entries: CatalogEntry[], toolsets: string[]): Set<string> {
  const known = new Set(entries.map((entry) => entry.toolset))
  const enabled = new Set(toolsets.map(toToolsetName))
  const unknown = [...enabled].filter((toolset) => !known.has(toolset))
  if (unknown.length > 0) {
    throw new Error(`Unknown toolset(s): ${unknown.join(', ')}. Available: ${[...known].sort().join(', ')}`)
  }
  return enabled
}

export function toToolsetName(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function buildEntry(endpoint: Endpoint, group: string): CatalogEntry {
  const route = endpoint.path.replace(/^\//, '')
  const verb = route.split('/').at(-1) ?? ''
  const readOnly =
    endpoint.readOnly ?? (READ_VERBS.has(verb) || READ_PREFIXES.some((prefix) => route.startsWith(prefix)))
  return {
    name: route.replaceAll('/', '_'),
    route,
    toolset: toToolsetName(endpoint.tags?.[0] ?? group),
    summary: getSummary(endpoint),
    readOnly,
    destructive: !readOnly && (endpoint.destructive ?? DESTRUCTIVE_VERBS.has(verb)),
    endpoint,
  }
}

function getSummary(endpoint: Endpoint): string {
  const description = firstSentence(endpoint.description ?? '')
  if (description) return description
  return endpoint.summary?.trim() ?? ''
}

function firstSentence(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  const end = line.search(/\.(\s|$)/)
  return end === -1 ? line : line.slice(0, end + 1)
}
