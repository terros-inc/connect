import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getTokens } from '@terros-inc/connect-common/auth'
import { readCache, writeCache } from '../cache'
import { buildTerrosClient } from '../api/query'
import { parseEndpoints } from './parser'

const profileSchema = z.looseObject({
  type: z.literal('success'),
  company: z.looseObject({ companyId: z.string() }),
})

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

function schemaText(data: unknown): string {
  const text = JSON.stringify(data)
  parseEndpoints(text)
  return text
}

export async function loadInternalSchema(): Promise<string | undefined> {
  try {
    const key = await cacheKey()
    if (!key) return undefined
    const client = buildTerrosClient()
    const cachedProfile = profileSchema.safeParse(await readCache('profile', key))
    const profile = cachedProfile.success
      ? cachedProfile.data
      : profileSchema.parse(await client.call('user/profile', {}))
    if (!cachedProfile.success) await writeCache('profile', key, profile)

    if (profile.company.companyId !== 'C:tantalim') return undefined

    const cachedSchema = await readCache('openapi', key)
    if (cachedSchema !== undefined) {
      try {
        return schemaText(cachedSchema)
      } catch {
        // Refresh a cached document that can no longer be parsed.
      }
    }
    const schema = await client.get<unknown>('openapi')
    const text = schemaText(schema)
    await writeCache('openapi', key, schema)
    return text
  } catch (error) {
    console.error(
      `Unable to load internal API commands; using bundled schema: ${error instanceof Error ? error.message : error}`
    )
    return undefined
  }
}
