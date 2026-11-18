import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'
import { environmentApiKeyVariable, resolveEnvironment } from '../../packages/connect-common/src/environment.ts'

const endpoint = process.env.TERROS_API_ENDPOINT?.trim()
const apiKey = process.env.TERROS_API_KEY?.trim()

if (!apiKey) {
  console.log('SKIP: TERROS_API_KEY is required for authenticated discovery.')
} else {
  const home = await mkdtemp(join(tmpdir(), 'terros-smoke-'))
  let stderr = ''
  try {
    assert.ok(endpoint, 'TERROS_API_ENDPOINT is required')
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../cli.js', import.meta.url)), 'api', 'refresh'],
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
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../cli.js', import.meta.url)), 'account', 'get', '--help'],
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
    const { stdout } = result
    stderr = result.stderr
    // A fresh backend schema is required: help alone can succeed using the bundled public schema.
    // A non-production backend caches its schema under its own environment directory, apart from production's.
    const url = new URL(/^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`)
    const stage =
      url.hostname === 'localhost'
        ? join('localhost', `port-${url.port || '80'}`)
        : /^api\.([a-z][a-z0-9-]*)\.terros\.com$/.exec(url.hostname)?.[1]
    const cacheDir = stage ? join(home, '.config', 'terros', 'env', stage) : join(home, '.config', 'terros')
    const cached = JSON.parse(await readFile(join(cacheDir, 'openapi.json'), 'utf8'))
    const schema = cached.data
    assert.ok(schema.paths['/account/get']?.post)
    assert.match(stdout, /^usage: terros account get \[parameters\]/m)
    console.log('PASS: authenticated backend command discovery (terros account get).')
  } catch (error) {
    const redact = (text) => String(text).replaceAll(apiKey, '[REDACTED]')
    console.error('FAIL: authenticated backend command discovery did not load the backend schema and command help.')
    console.error(redact(error instanceof Error ? error.message : error))
    const cliStderr = error?.stderr || stderr
    if (cliStderr) console.error(redact(cliStderr))
    process.exitCode = 1
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
