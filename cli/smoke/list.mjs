import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { environmentApiKeyVariable, resolveEnvironment } from '../../packages/connect-common/src/environment.ts'

const endpoint = process.env.TERROS_API_ENDPOINT?.trim()
// Only the key variable of the selected environment is read: the generic TERROS_API_KEY is a production key and
// must never be forwarded to staging.
const keyVariable = environmentApiKeyVariable(resolveEnvironment({ TERROS_API_ENDPOINT: endpoint }))
const apiKey = process.env[keyVariable]?.trim()

if (!apiKey) {
  console.log(`SKIP: ${keyVariable} is required for authenticated list execution.`)
} else {
  const home = await mkdtemp(join(tmpdir(), 'terros-smoke-list-'))
  let stderr = ''
  let stage = 'endpoint configuration'
  try {
    assert.ok(endpoint, 'TERROS_API_ENDPOINT is required')
    stage = 'CLI execution (expected exit 0)'
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../cli.js', import.meta.url)), 'company', 'list'],
      {
        env: {
          HOME: home,
          TERROS_API_ENDPOINT: endpoint,
          [environmentApiKeyVariable(resolveEnvironment({ TERROS_API_ENDPOINT: endpoint }))]: apiKey,
        },
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }
    )
    stderr = result.stderr
    stage = 'JSON parsing'
    const response = JSON.parse(result.stdout)
    stage = 'list response shape'
    assert.ok(response?.type === 'success' && Array.isArray(response.companies), 'Expected a company list success')
    console.log('PASS: authenticated read-only list (terros company list).')
  } catch (error) {
    console.error(`FAIL: authenticated read-only list failed at ${stage}.`)
    // CLI errors and parse errors can include tenant data as well as the API key.
    console.error('Error: [REDACTED]')
    if (error?.stderr || stderr) console.error('CLI stderr: [REDACTED]')
    process.exitCode = 1
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
