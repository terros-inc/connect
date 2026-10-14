import { resolveSchema } from './parameters.ts'
import type { Endpoint } from './endpoint.ts'
import type { Catalog, CatalogEntry } from './catalog.ts'

export type SearchResult = {
  name: string
  summary: string
  toolset: string
  readOnly: boolean
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'from', 'in', 'my', 'of', 'on', 'or', 'the', 'to', 'with'])

/** Field weights: route and title words count most, free-text description least. */
const WEIGHTS = { route: 4, title: 3, toolset: 2, property: 1, description: 1 }

export const DEFAULT_SEARCH_LIMIT = 8

/** Rank catalog entries by how many query words their route, title, toolset, inputs and description contain. */
export function searchCatalog(catalog: Catalog, query: string, limit = DEFAULT_SEARCH_LIMIT): SearchResult[] {
  const words = tokenize(query)
  if (words.length === 0) return []
  return catalog.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, words) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    .slice(0, limit)
    .map(({ entry }) => ({
      name: entry.name,
      summary: entry.summary,
      toolset: entry.toolset,
      readOnly: entry.readOnly,
    }))
}

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem)
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function scoreEntry(entry: CatalogEntry, words: string[]): number {
  const fields = getSearchFields(entry)
  let score = 0
  for (const word of words) {
    let best = 0
    for (const [field, weight] of Object.entries(WEIGHTS)) {
      if (fields.get(field)?.has(word)) best = Math.max(best, weight)
    }
    score += best
  }
  return score
}

const fieldCache = new WeakMap<Endpoint, Map<string, Set<string>>>()

function getSearchFields(entry: CatalogEntry): Map<string, Set<string>> {
  const cached = fieldCache.get(entry.endpoint)
  if (cached) return cached
  const fields = new Map<string, Set<string>>([
    ['route', new Set(tokenize(entry.route))],
    ['title', new Set(tokenize(entry.endpoint.summary ?? ''))],
    ['toolset', new Set(tokenize(entry.toolset))],
    ['property', new Set(tokenize(getPropertyNames(entry).join(' ')))],
    ['description', new Set(tokenize(entry.endpoint.description ?? ''))],
  ])
  fieldCache.set(entry.endpoint, fields)
  return fields
}

function getPropertyNames(entry: CatalogEntry): string[] {
  try {
    const schema = resolveSchema(entry.endpoint.properties, entry.endpoint.components)
    if (!('type' in schema) || schema.type !== 'object' || !schema.properties) return []
    return Object.keys(schema.properties)
  } catch {
    return []
  }
}
