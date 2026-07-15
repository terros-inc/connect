import { platform, release } from 'node:os'
import packageJson from '../package.json'

type TerrosHeaderMetadata = {
  'Terros-Platform'?: string
  'Terros-Platform-Version'?: string
  'Terros-Bundle-Identifier'?: string
  'Terros-App-Version'?: string
}

export function getAnalyticsHeaders(): TerrosHeaderMetadata {
  if (typeof globalThis.process === 'undefined') return {}

  try {
    return {
      'Terros-Platform': platform(),
      'Terros-Platform-Version': release(),
      'Terros-Bundle-Identifier': 'com.terros.sdk',
      'Terros-App-Version': packageJson.version,
    }
  } catch {
    return {}
  }
}
