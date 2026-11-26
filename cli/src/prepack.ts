import { readFileSync } from 'node:fs'
import { commandRegistry } from './commands'
import { checkReleaseSchema } from './releaseSchema'

// `prepack` runs this on the terros.yml it just downloaded, which the release then bundles.
try {
  checkReleaseSchema(readFileSync('terros.yml', 'utf8'), commandRegistry)
} catch (error) {
  console.error(`terros.yml cannot be released: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
