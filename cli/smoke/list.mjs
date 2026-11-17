import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'

const endpoint = process.env.TERROS_API_ENDPOINT?.trim()
const apiKey = process.env.TERROS_API_KEY?.trim()

if (!apiKey) {
  console.log('SKIP: TERROS_API_KEY is required for authenticated list execution.')
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
        env: { HOME: home, TERROS_API_ENDPOINT: endpoint, TERROS_API_KEY: apiKey },
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
