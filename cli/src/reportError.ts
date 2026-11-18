import { resolveEnvironment } from '@terros-inc/connect-common'

export function reportError(error: unknown): void {
  let name: string
  try {
    name = resolveEnvironment().name
  } catch {
    name = 'prod'
  }
  if (name !== 'prod')
    console.error(`[${name}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  else console.error(error)
}
