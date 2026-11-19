import { createHash } from 'node:crypto'
import { loadInternalSpec } from '@terros-inc/mcp-core'
import { AuthRequiredError, getTokens, readTokens } from '@terros-inc/connect-common/auth'
import { environmentApiKey, resolveEnvironment } from '@terros-inc/connect-common'
import { reportError } from '../reportError'
import { readCache, writeCache } from '../cache'
import { buildTerrosClient } from '../api/query'

// JWT claims only partition local caches; the API still authenticates every request.
function tokenIdentity(token: string | undefined): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token?.split('.')[1] ?? '', 'base64url').toString())
    if (typeof claims.sub === 'string') return JSON.stringify([claims.iss, claims.sub])
  } catch {
    // Opaque tokens use the login's refresh token as their cache identity.
  }
  return undefined
}

export async function cacheKey(offline = false): Promise<string | undefined> {
  let identity = environmentApiKey(resolveEnvironment())
  if (!identity) {
    const tokens = await (offline ? readTokens() : getTokens())
    if (!tokens?.access_token) return undefined
    identity = tokenIdentity(tokens.id_token) ?? tokenIdentity(tokens.access_token) ?? tokens.refresh_token
  }
  if (!identity) return undefined
  return createHash('sha256')
    .update(JSON.stringify([identity, process.env.TERROS_API_ENDPOINT, process.env.TERROS_IMPERSONATE]))
    .digest('hex')
}

export type InternalSchemaResult = {
  schema?: string
  status: 'available' | 'unavailable' | 'failed'
}

export async function loadInternalSchemaWithStatus(): Promise<InternalSchemaResult> {
  try {
    const key = await cacheKey()
    if (!key) return { status: 'unavailable' }
    const schema = await loadInternalSpec({
      client: buildTerrosClient(),
      internalCompanyId: 'C:tantalim',
      cache: {
        read: (name) => readCache(name, key),
        write: (name, data) => writeCache(name, key, data),
      },
    })
    return schema === undefined ? { status: 'unavailable' } : { schema, status: 'available' }
  } catch (error) {
    // Signed out or expired is not a schema problem: stay quiet so the command itself reports it once.
    if (error instanceof AuthRequiredError) return { status: 'unavailable' }
    reportError(
      `Unable to load internal API commands; using bundled schema: ${error instanceof Error ? error.message : error}`
    )
    return { status: 'failed' }
  }
}

export async function loadInternalSchema(): Promise<string | undefined> {
  return (await loadInternalSchemaWithStatus()).schema
}
