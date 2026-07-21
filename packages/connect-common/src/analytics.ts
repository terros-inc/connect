import { platform, release } from 'node:os'

export type TerrosHeaderMetadata = {
  'Terros-Platform'?: string
  'Terros-Platform-Version'?: string
  'Terros-Bundle-Identifier'?: string
  'Terros-App-Version'?: string
}

export function getAnalyticsHeaders(override: TerrosHeaderMetadata = {}): TerrosHeaderMetadata {
  if (typeof globalThis.process === 'undefined') return {}

  try {
    return {
      'Terros-Platform': platform(),
      'Terros-Platform-Version': release(),
      'Terros-Bundle-Identifier': 'com.terros.sdk',
      ...override
    }
  } catch {
    return {}
  }
}
