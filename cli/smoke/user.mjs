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
  console.log('SKIP: TERROS_API_KEY is required for authenticated user lookup.')
} else {
  let home
  let stderr = ''
  let stage = 'prepare an isolated HOME and API endpoint'
  try {
    home = await mkdtemp(join(tmpdir(), 'terros-smoke-'))
    assert.ok(endpoint)
    stage = 'run terros api call user/profile'
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../cli.js', import.meta.url)), 'api', 'call', 'user/profile'],
      {
        env: { HOME: home, TERROS_API_ENDPOINT: endpoint, TERROS_API_KEY: apiKey },
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }
    )
    stderr = result.stderr
    stage = 'parse the user/profile JSON response'
    const response = JSON.parse(result.stdout)
    stage = 'validate the user/profile response shape'
    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    assert.ok(isObject(response) && response.type === 'success')
    assert.ok(isObject(response.user) && typeof response.user.userId === 'string')
    assert.ok(isObject(response.company) && typeof response.company.companyId === 'string')
    console.log('PASS: authenticated user lookup response shape (terros api call user/profile).')
  } catch (error) {
    console.error(`FAIL: authenticated user lookup could not ${stage}.`)
    // Child errors, parser errors and stderr can contain profile data as well as the key.
    console.error('Error: [REDACTED]')
    if (error?.stderr || stderr) console.error('CLI stderr: [REDACTED]')
    process.exitCode = 1
  } finally {
    if (home) {
      try {
        await rm(home, { recursive: true, force: true })
      } catch {
        console.error('FAIL: temporary HOME cleanup failed. Error: [REDACTED]')
        process.exitCode = 1
      }
    }
  }
}
