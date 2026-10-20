import { TerrosApiClient, type TerrosClientConfig } from '@terros-inc/connect-common'
import packageJson from '../../package.json'

export function buildTerrosClient(config: Omit<TerrosClientConfig, 'analytics'> = {}): TerrosApiClient {
  return new TerrosApiClient({
    ...config,
    analytics: { 'Terros-Bundle-Identifier': 'com.terros.cli', 'Terros-Platform-Version': packageJson.version },
  })
}
