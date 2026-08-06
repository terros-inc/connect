import type { ParsedArgs } from 'minimist'
import { TerrosApiClient } from '@terros-inc/connect-common'
import packageJson from '../../package.json'

export function buildTerrosClient(params: ParsedArgs): TerrosApiClient {
  return new TerrosApiClient({
    analytics: { 'Terros-Bundle-Identifier': 'com.terros.cli', 'Terros-Platform-Version': packageJson.version },
    impersonateUserId: parseImpersonateUserId(params),
  })
}

function parseImpersonateUserId(params: ParsedArgs): string | undefined {
  const value = params.impersonate
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    throw new Error('Parameter --impersonate expects a single string value')
  }

  return String(value)
}
