import { TerrosApiClient } from '@terros-inc/connect-common'
import packageJson from '../../package.json'

export function buildTerrosClient(): TerrosApiClient {
  return new TerrosApiClient({
    analytics: { 'Terros-Bundle-Identifier': 'com.terros.cli', 'Terros-Platform-Version': packageJson.version },
  })
}
