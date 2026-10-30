import { PermanentError, TerrosClient } from '@terros-inc/sdk'

export type Secrets = {
  targetApiKey?: string
}

/** The `accountSource` copied accounts get in the target company. */
export const MIRROR_SOURCE = 'Terros Mirror'

/**
 * A client for the target company. The install's own Connect token is scoped to the source company, and Terros has no
 * cross-company sharing, so every write to the target goes through the target company's own API key.
 */
export function targetClient(secrets: Secrets): TerrosClient {
  if (!secrets.targetApiKey) throw new PermanentError('The targetApiKey install secret is not set')
  return new TerrosClient({ apiKey: secrets.targetApiKey, authType: 'ApiKey' })
}
