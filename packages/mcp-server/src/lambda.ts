import { readFileSync } from 'node:fs'
import { loadEndpoints } from '@terros-inc/mcp-core'
import { createLambdaHandler } from './proxy.ts'
import { createRemoteMcpHandler } from './handler.ts'
import { readConfig } from './config.ts'
import { createAuth0Verifier } from './auth.ts'

const config = readConfig()
const version = process.env.MCP_SERVER_VERSION ?? 'unknown'

export const handler = createLambdaHandler(
  createRemoteMcpHandler({
    config,
    version,
    verifier: createAuth0Verifier({ issuer: config.issuer, audience: config.audience }),
    endpoints: () => loadEndpoints({ bundled: () => readFileSync(new URL('./terros.yml', import.meta.url), 'utf8') }),
    onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })),
  })
)
