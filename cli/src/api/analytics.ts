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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function getAnalyticsHeaders(): TerrosHeaderMetadata {
  const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
    version?: string
  }

  return {
    'Terros-Platform': platform(),
    'Terros-Platform-Version': release(),
    'Terros-Bundle-Identifier': 'com.terros.cli',
    'Terros-App-Version': packageJson.version,
  }
}
