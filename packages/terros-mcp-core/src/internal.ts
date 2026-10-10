import type { ApiClient } from './tools.ts'
import { parseEndpoints } from './parser.ts'

export type InternalApiClient = ApiClient & {
  get<Success>(route: string): Promise<Success>
}

export type InternalSpecCache = {
  read(name: 'profile' | 'openapi'): Promise<unknown>
  write(name: 'profile' | 'openapi', data: unknown): Promise<void>
}

export type InternalSpecOptions = {
  client: InternalApiClient
  cache?: InternalSpecCache
  internalCompanyId?: string
}

type Profile = { type: 'success'; company: { companyId: string } }

function isProfile(value: unknown): value is Profile {
  if (value === null || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  if (profile.type !== 'success' || profile.company === null || typeof profile.company !== 'object') return false
  return typeof (profile.company as Record<string, unknown>).companyId === 'string'
}

function schemaText(data: unknown): string {
  const text = JSON.stringify(data)
  parseEndpoints(text)
  return text
}

/** Resolve the staff-only schema using injected API and optional cache adapters. */
export async function loadInternalSpec(options: InternalSpecOptions): Promise<string | undefined> {
  const cachedProfile = await options.cache?.read('profile')
  let profile: Profile
  if (isProfile(cachedProfile)) {
    profile = cachedProfile
  } else {
    const fetched = await options.client.call<unknown>('user/profile', {})
    if (!isProfile(fetched)) throw new Error('Invalid user profile response')
    profile = fetched
    await options.cache?.write('profile', profile)
  }

  if (profile.company.companyId !== (options.internalCompanyId ?? 'C:tantalim')) return undefined

  const cachedSchema = await options.cache?.read('openapi')
  if (cachedSchema !== undefined) {
    try {
      return schemaText(cachedSchema)
    } catch {
      // Refresh a cached document that can no longer be parsed.
    }
  }

  const schema = await options.client.get<unknown>('openapi')
  const text = schemaText(schema)
  await options.cache?.write('openapi', schema)
  return text
}
