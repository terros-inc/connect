import { readFileSync } from 'node:fs'
import { loadEndpoints } from '@terros-inc/mcp-core'
import { createLambdaHandler } from './proxy.ts'
import { createRemoteMcpHandler } from './handler.ts'
import { createAuth0TokenExchange } from './exchange.ts'
import { readConfig } from './config.ts'
import { createAuth0Verifier } from './auth.ts'

const config = readConfig()
const version = process.env.MCP_SERVER_VERSION ?? 'unknown'

let clientSecret: Promise<string> | undefined
/** The token exchange client secret, read from Secrets Manager on first use and kept for the life of the container. */
function readClientSecret(): Promise<string> {
  clientSecret ??= (async () => {
    // Provided by the Lambda Node.js runtime, so it is not bundled (see tsdown.config.ts).
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
    const { SecretString } = await new SecretsManagerClient({}).send(
      new GetSecretValueCommand({ SecretId: config.tokenExchangeSecretId })
    )
    if (!SecretString) throw new Error('The token exchange client secret is empty')
    return SecretString.trim()
  })().catch((error: unknown) => {
    clientSecret = undefined
    throw error
  })
  return clientSecret
}

export const handler = createLambdaHandler(
  createRemoteMcpHandler({
    config,
    version,
    // The server is its own audience: clients get tokens for https://mcp.terros.com, never for the Terros API.
    verifier: createAuth0Verifier({ issuer: config.issuer, audience: config.resource }),
    exchangeToken: createAuth0TokenExchange({
      issuer: config.issuer,
      audience: config.apiAudience,
      clientId: config.tokenExchangeClientId,
      clientSecret: readClientSecret,
    }),
    endpoints: () => loadEndpoints({ bundled: () => readFileSync(new URL('./terros.yml', import.meta.url), 'utf8') }),
    onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })),
  })
)
