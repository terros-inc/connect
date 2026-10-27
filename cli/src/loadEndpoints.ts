import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { loadEndpoints as loadCoreEndpoints, parseEndpoints, type EndpointGroups } from '@terros-inc/mcp-core'
import { loadInternalSchema, loadInternalSchemaWithStatus } from './crud/internal'
import { readCache, writeCache } from './cache'

const PUBLIC_SCHEMA_URL = 'https://docs.terros.com/openapi/terros.yml'
// A 304 takes about 130 ms, so a normal command checks at most once per interval and gives up after CHECK_TIMEOUT,
// keeping the copy it has: an offline or slow network never holds a command up noticeably. A missing command or
// `terros api refresh` revalidates immediately and waits up to REFRESH_TIMEOUT, since the command fails without it.
const REVALIDATE_INTERVAL = 5 * 60 * 1000
const CHECK_TIMEOUT = 300
const REFRESH_TIMEOUT = 2000

/** Whether the refreshed schema came from the network, so a still-missing command is not just a stale copy. */
export type SchemaStatus = 'available' | 'failed'

type PublicSchemaCache = { checkedAt: number; etag?: string; schema?: string }

function bundled(): string {
  return readFileSync(new URL('../terros.yml', import.meta.url), 'utf8')
}

function isPublicSchemaCache(value: unknown): value is PublicSchemaCache {
  if (value === null || typeof value !== 'object') return false
  const cache = value as Record<string, unknown>
  return (
    typeof cache.checkedAt === 'number' &&
    (cache.etag === undefined || typeof cache.etag === 'string') &&
    (cache.schema === undefined || typeof cache.schema === 'string')
  )
}

/** A captive portal or misrouted response can parse as YAML; caching it would erase every command. */
function isOpenApiDocument(text: string): boolean {
  const document: unknown = parse(text)
  if (document === null || typeof document !== 'object') return false
  const { openapi, paths } = document as Record<string, unknown>
  return (
    typeof openapi === 'string' &&
    paths !== null &&
    typeof paths === 'object' &&
    !Array.isArray(paths) &&
    Object.keys(paths).length > 0
  )
}

/**
 * The public API document, from docs.terros.com when it can be fetched, else the last good copy, else the copy bundled
 * at build time. Revalidated with `If-None-Match`, so an unchanged document costs a body-less 304. The document only
 * decides which commands are listed; the API still authorizes every request.
 */
async function loadPublicSchema({ revalidate = false } = {}): Promise<{ schema: string; status: SchemaStatus }> {
  const read = await readCache('public-openapi', PUBLIC_SCHEMA_URL, Infinity)
  const cached = isPublicSchemaCache(read) ? read : undefined
  const age = Date.now() - (cached?.checkedAt ?? 0)
  if (!revalidate && age >= 0 && age < REVALIDATE_INTERVAL) {
    return { schema: cached?.schema ?? bundled(), status: 'available' }
  }

  let next: PublicSchemaCache = { ...cached, checkedAt: Date.now() }
  let status: SchemaStatus = 'failed'
  try {
    const response = await fetch(PUBLIC_SCHEMA_URL, {
      headers: cached?.schema && cached.etag ? { 'If-None-Match': cached.etag } : {},
      signal: AbortSignal.timeout(revalidate ? REFRESH_TIMEOUT : CHECK_TIMEOUT),
    })
    if (response.status === 304 && cached?.schema) {
      status = 'available'
    } else if (response.ok) {
      const schema = await response.text()
      if (!isOpenApiDocument(schema)) throw new Error('Not an OpenAPI document')
      parseEndpoints(schema)
      next = { checkedAt: next.checkedAt, etag: response.headers.get('etag') ?? undefined, schema }
      status = 'available'
    }
  } catch {
    // Offline, timed out, or not a usable document: keep the last good copy.
  }
  // A failed check is recorded too, so an offline CLI waits on the network at most once per interval.
  await writeCache('public-openapi', PUBLIC_SCHEMA_URL, next).catch(() => {})
  return { schema: next.schema ?? bundled(), status }
}

export function loadEndpoints(): Promise<EndpointGroups> {
  return loadCoreEndpoints({
    bundled: async () => (await loadPublicSchema()).schema,
    internal: loadInternalSchema,
  })
}

export async function loadEndpointsAfterRefresh(): Promise<{ endpoints: EndpointGroups; schemaStatus: SchemaStatus }> {
  const internal = await loadInternalSchemaWithStatus()
  if (internal.schema !== undefined) {
    return { endpoints: await loadCoreEndpoints({ bundled: internal.schema }), schemaStatus: 'available' }
  }
  const publicSchema = await loadPublicSchema({ revalidate: true })
  return {
    endpoints: await loadCoreEndpoints({ bundled: publicSchema.schema }),
    // A staff user whose internal schema failed is likely missing an internal command, which the public one lacks.
    schemaStatus: internal.status === 'failed' ? 'failed' : publicSchema.status,
  }
}
