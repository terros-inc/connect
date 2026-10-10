import { createHash } from 'node:crypto'
import { loadInternalSpec } from '@terros-inc/mcp-core'
import { getTokens } from '@terros-inc/connect-common/auth'
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

async function cacheKey(): Promise<string | undefined> {
  let identity = process.env.TERROS_API_KEY
  if (!identity) {
    const tokens = await getTokens()
    if (!tokens?.access_token) return undefined
    identity = tokenIdentity(tokens.id_token) ?? tokenIdentity(tokens.access_token) ?? tokens.refresh_token
  }
  return createHash('sha256')
    .update(JSON.stringify([identity, process.env.TERROS_API_ENDPOINT, process.env.TERROS_IMPERSONATE]))
    .digest('hex')
}

export async function loadInternalSchema(): Promise<string | undefined> {
  try {
    const key = await cacheKey()
    if (!key) return undefined
    return await loadInternalSpec({
      client: buildTerrosClient(),
      cache: {
        read: (name) => readCache(name, key),
        write: (name, data) => writeCache(name, key, data),
      },
    })
  } catch (error) {
    console.error(
      `Unable to load internal API commands; using bundled schema: ${error instanceof Error ? error.message : error}`
    )
    return undefined
  }
}
