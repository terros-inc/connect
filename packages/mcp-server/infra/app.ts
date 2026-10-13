import { existsSync, readFileSync } from 'node:fs'
import { Code } from 'aws-cdk-lib/aws-lambda'
import { App } from 'aws-cdk-lib'
import { resolveStage } from './stages.ts'
import { McpServerStack } from './stack.ts'

const app = new App()
const settings = resolveStage((key) => {
  const value: unknown = app.node.tryGetContext(key)
  return typeof value === 'string' && value !== '' ? value : undefined
})

const dist = new URL('../dist/', import.meta.url)
for (const file of ['lambda.mjs', 'terros.yml']) {
  if (!existsSync(new URL(file, dist))) throw new Error(`dist/${file} is missing; run \`pnpm package\` first`)
}
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

new McpServerStack(app, `TerrosMcpServer-${settings.stage}`, {
  ...settings,
  code: Code.fromAsset(dist.pathname),
  version,
  // Route 53 health check metrics are only published in us-east-1.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  tags: { service: 'terros-mcp', stage: settings.stage },
})
