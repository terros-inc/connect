import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'

const endpoint = process.env.TERROS_API_ENDPOINT?.trim()
const apiKey = process.env.TERROS_API_KEY?.trim()

if (!endpoint || !apiKey) {
  console.log('SKIP: TERROS_API_ENDPOINT and TERROS_API_KEY are required for authenticated discovery.')
} else {
  const home = await mkdtemp(join(tmpdir(), 'terros-smoke-'))
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../cli.js', import.meta.url)), 'account', 'get', '--help'],
      {
        env: { HOME: home, TERROS_API_ENDPOINT: endpoint, TERROS_API_KEY: apiKey },
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }
    )
    // A fresh backend schema is required: help alone can succeed using the bundled public schema.
    const cached = JSON.parse(await readFile(join(home, '.config', 'terros', 'openapi.json'), 'utf8'))
    const schema = JSON.parse(cached.data)
    assert.ok(schema.paths['/account/get']?.post)
    assert.match(stdout, /^usage: terros account get \[parameters\]/m)
    console.log('PASS: authenticated backend command discovery (terros account get).')
  } catch {
    console.error('FAIL: authenticated backend command discovery did not load the backend schema and command help.')
    process.exitCode = 1
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
