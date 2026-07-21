import * as process from 'node:process'
import { TerrosApiClient } from '@terros-inc/connect-common'
import packageJson from '../../package.json'

export function buildTerrosClient(): TerrosApiClient {
  return new TerrosApiClient({
    analytics: { 'Terros-Bundle-Identifier': 'com.terros.cli', 'Terros-Platform-Version': packageJson.version },
  })
}

function getImpersonationHeaders(): Record<string, string> {
  const userId = process.env.TERROS_IMPERSONATE
  if (userId) return { impersonate_user_id: userId }

  return {}
}
