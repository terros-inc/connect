import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { platform, release } from 'node:os'
import { readFileSync } from 'node:fs'

type TerrosHeaderMetadata = {
  'Terros-Platform'?: string
  'Terros-Platform-Version'?: string
  'Terros-Bundle-Identifier'?: string
  'Terros-App-Version'?: string
}

export function getAnalyticsHeaders(): TerrosHeaderMetadata {
  if (typeof globalThis.process === 'undefined') return {}

  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
      version?: string
    }

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
