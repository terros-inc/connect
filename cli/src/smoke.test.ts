import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const marker = 'redaction-example-marker'

it.each([
  {
    name: 'a failing CLI hides neither the backend error nor its stderr, and redacts the key',
    cli: `console.error('Backend unavailable: ' + process.env.TERROS_API_KEY); process.exitCode = 1`,
    message: 'Command failed:',
    diagnostic: 'Backend unavailable: [REDACTED]',
  },
  {
    name: 'a help assertion failure retains successful CLI stderr and redacts assertion output',
    cli: `
      const fs = require('node:fs')
      const path = require('node:path')
      const directory = path.join(process.env.HOME, '.config', 'terros')
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, 'openapi.json'), JSON.stringify({
        data: { paths: { '/account/get': { post: {} } } }
      }))
      console.log('Changed help: ' + process.env.TERROS_API_KEY)
      console.error('Schema warning: ' + process.env.TERROS_API_KEY)
    `,
    message: 'Changed help: [REDACTED]',
    diagnostic: 'Schema warning: [REDACTED]',
  },
])('$name', async ({ cli, message, diagnostic }) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-diagnostics-'))
  try {
    const smoke = join(directory, 'smoke')
    await mkdir(smoke)
    await copyFile(new URL('../smoke/discovery.mjs', import.meta.url), join(smoke, 'discovery.mjs'))
    await writeFile(join(directory, 'cli.js'), cli)
    const result = spawnSync(process.execPath, [join(smoke, 'discovery.mjs')], {
      env: { TERROS_API_ENDPOINT: 'https://api.example.test', TERROS_API_KEY: marker },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.stderr).toContain(diagnostic)
    expect(result.stderr).not.toContain(marker)
    expect(result.stdout).not.toContain(marker)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  {
    name: 'an empty company list passes without requiring staging tenant records',
    output: JSON.stringify({ type: 'success', companies: [] }),
    exitCode: 0,
    expectedStatus: 0,
  },
  {
    name: 'a populated company list passes without logging records or successful stderr',
    output: JSON.stringify({ type: 'success', companies: [{ companyId: 'C.example', name: 'Acme Solar' }] }),
    exitCode: 0,
    expectedStatus: 0,
  },
  {
    name: 'a nonzero CLI exit fails even when stdout contains a valid list',
    output: JSON.stringify({ type: 'success', companies: [] }),
    exitCode: 1,
    expectedStatus: 1,
  },
  {
    name: 'malformed JSON fails without leaking parser excerpts containing the key or tenant data',
    output: `Acme Solar C.example ${marker}`,
    exitCode: 0,
    expectedStatus: 1,
  },
  {
    name: 'a JSON error response cannot pass as a company list or leak assertion values',
    output: JSON.stringify({ type: 'error', companies: [], message: `Acme Solar C.example ${marker}` }),
    exitCode: 0,
    expectedStatus: 1,
  },
  {
    name: 'a non-array companies field fails instead of accepting any JSON success',
    output: JSON.stringify({ type: 'success', companies: {} }),
    exitCode: 0,
    expectedStatus: 1,
  },
])('$name', async ({ output, exitCode, expectedStatus }) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-list-test-'))
  try {
    const smoke = join(directory, 'smoke')
    await mkdir(smoke)
    await copyFile(new URL('../smoke/list.mjs', import.meta.url), join(smoke, 'list.mjs'))
    await writeFile(
      join(directory, 'cli.js'),
      `
        const assert = require('node:assert/strict')
        assert.deepEqual(process.argv.slice(2), ['company', 'list'])
        assert.ok(process.env.HOME)
        console.log(${JSON.stringify(output)})
        console.error('Acme Solar C.example ' + process.env.TERROS_API_KEY)
        process.exitCode = ${exitCode}
      `
    )
    const result = spawnSync(process.execPath, [join(smoke, 'list.mjs')], {
      env: { TERROS_API_ENDPOINT: 'https://api.example.test', TERROS_API_KEY: marker },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(expectedStatus)
    expect(result.stdout + result.stderr).not.toContain(marker)
    expect(result.stdout + result.stderr).not.toContain('Acme Solar')
    expect(result.stdout + result.stderr).not.toContain('C.example')
    if (expectedStatus === 1) {
      expect(result.stderr).toContain('Error: [REDACTED]')
      expect(result.stderr).toContain('CLI stderr: [REDACTED]')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
