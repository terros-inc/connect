import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { environmentApiKeyVariable, resolveEnvironment } from '../../packages/connect-common/src/environment.ts'

const endpoint = process.env.TERROS_API_ENDPOINT?.trim()
const apiKey = 'invalid-smoke-test-key'
const redact = (text) => String(text).replaceAll(apiKey, '[REDACTED]')
const home = await mkdtemp(join(tmpdir(), 'terros-smoke-auth-'))
let stderr = ''

try {
  assert.ok(endpoint, 'TERROS_API_ENDPOINT is required')
  let exitCode = 0
  let stdout = ''
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../cli.js', import.meta.url)), 'whoami'],
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
    stdout = redact(result.stdout)
    stderr = redact(result.stderr)
  } catch (error) {
    stderr = redact(error?.stderr ?? '')
    assert.ok(Number.isInteger(error?.code) && error.code !== 0, redact(error.message))
    assert.ok(!error.killed && !error.signal, 'CLI must exit normally, without a timeout or signal')
    exitCode = error.code
    stdout = redact(error.stdout ?? '')
  }
  assert.notEqual(exitCode, 0, 'CLI must reject an invalid API key')
  assert.doesNotMatch(`${stdout}\n${stderr}`, /^\s+at\s+.+/m, 'CLI must not print a stack trace')
  assert.equal(
    stderr
      .trim()
      .split('\n')
      .at(-1)
      ?.replace(/^\[[^\]]+\] /, '') ?? '',
    'Invalid or unauthorized API key',
    'CLI must report a clear authentication error'
  )
  console.log('PASS: invalid API key fails cleanly without a stack trace.')
} catch (error) {
  console.error('FAIL: invalid API key did not produce a clean authentication failure.')
  console.error(redact(error instanceof Error ? error.message : error))
  if (stderr) console.error(redact(stderr))
  process.exitCode = 1
} finally {
  await rm(home, { recursive: true, force: true })
}
