import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
      if (process.argv[2] === 'api') process.exit(0)
      console.log('Changed help: ' + process.env.TERROS_API_KEY)
      console.error('Schema warning: ' + process.env.TERROS_API_KEY)
    `,
    message: 'Changed help: [REDACTED]',
    diagnostic: 'Schema warning: [REDACTED]',
  },
])('$name', async ({ cli, message, diagnostic }) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-diagnostics-'))
  try {
    const smoke = join(directory, 'cli', 'smoke')
    await mkdir(smoke, { recursive: true })
    const shared = join(directory, 'packages', 'connect-common', 'src')
    await mkdir(shared, { recursive: true })
    await copyFile(
      new URL('../../packages/connect-common/src/environment.ts', import.meta.url),
      join(shared, 'environment.ts')
    )
    await copyFile(new URL('../smoke/discovery.mjs', import.meta.url), join(smoke, 'discovery.mjs'))
    await writeFile(join(directory, 'cli', 'cli.js'), cli)
    const result = spawnSync(process.execPath, [join(smoke, 'discovery.mjs')], {
      env: { TERROS_API_ENDPOINT: 'https://api.terros.com', TERROS_API_KEY: marker },
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
    name: 'accepts a clean auth rejection without a staging secret',
    code: 1,
    stderr: 'Invalid or unauthorized API key',
    status: 0,
  },
  {
    name: 'rejects a successful exit even with auth error text',
    code: 0,
    stderr: 'Invalid or unauthorized API key',
    status: 1,
  },
  {
    name: 'rejects a bare server reason phrase instead of the client contract',
    code: 1,
    stderr: 'Forbidden',
    status: 1,
  },
  { name: 'rejects an unrelated network failure', code: 1, stderr: 'fetch failed', status: 1 },
  {
    name: 'does not mistake a schema auth warning for the command failure',
    code: 1,
    stderr: 'Unable to load internal API commands: Invalid or unauthorized API key\nfetch failed',
    status: 1,
  },
  {
    name: 'rejects a stack trace on stderr and redacts diagnostics',
    code: 1,
    stderr: 'Invalid or unauthorized API key\n    at request (file:///example.js:1:2)',
    status: 1,
  },
  {
    name: 'rejects a stack trace on stdout',
    code: 1,
    stderr: 'Invalid or unauthorized API key',
    stdout: 'Error: Invalid or unauthorized API key\n    at request (file:///example.js:1:2)',
    status: 1,
  },
])('auth smoke $name', async ({ code, stderr, stdout = '', status }) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-auth-test-'))
  try {
    const smoke = join(directory, 'cli', 'smoke')
    await mkdir(smoke, { recursive: true })
    const shared = join(directory, 'packages', 'connect-common', 'src')
    await mkdir(shared, { recursive: true })
    await copyFile(
      new URL('../../packages/connect-common/src/environment.ts', import.meta.url),
      join(shared, 'environment.ts')
    )
    await copyFile(new URL('../smoke/auth.mjs', import.meta.url), join(smoke, 'auth.mjs'))
    await writeFile(
      join(directory, 'cli', 'cli.js'),
      `
        const assert = require('node:assert/strict')
        assert.deepEqual(process.argv.slice(2), ['whoami'])
        assert.equal(process.env.TERROS_API_ENDPOINT, 'https://api.terros.com')
        assert.ok(process.env.HOME)
        assert.notEqual(process.env.HOME, ${JSON.stringify(directory)})
        assert.ok(process.env.TERROS_API_KEY)
        console.error(process.env.TERROS_API_KEY + '\\n' + ${JSON.stringify(stderr)})
        console.log(${JSON.stringify(stdout)} + process.env.TERROS_API_KEY)
        process.exitCode = ${code}
      `
    )
    const result = spawnSync(process.execPath, [join(smoke, 'auth.mjs')], {
      env: { TERROS_API_ENDPOINT: 'https://api.terros.com' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(status)
    expect(result.stdout + result.stderr).not.toContain('invalid-smoke-test-key')
    if (status === 1) {
      expect(result.stderr).toContain('FAIL:')
      expect(result.stderr).toContain(stderr)
      expect(result.stderr).toContain('[REDACTED]')
    } else {
      expect(result.stdout).toContain('PASS:')
      expect(result.stderr).toBe('')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  { name: 'accepts a profile without exposing its fields or successful stderr', output: 'profile', status: 0 },
  {
    name: 'rejects an API error envelope',
    output: '{ type: "error", user: profile.user, company: profile.company }',
    status: 1,
  },
  { name: 'rejects a missing user', output: '{ type: "success", company: profile.company }', status: 1 },
  { name: 'rejects a malformed user ID', output: '{ ...profile, user: { userId: 123 } }', status: 1 },
  { name: 'rejects a missing company', output: '{ type: "success", user: profile.user }', status: 1 },
  { name: 'rejects a malformed company ID', output: '{ ...profile, company: { companyId: [] } }', status: 1 },
  { name: 'redacts malformed JSON parser errors and stderr', output: '"invalid JSON " + privateData', status: 1 },
  { name: 'redacts failed subprocess errors and stderr', output: 'profile', exitCode: 1, status: 1 },
  { name: 'skips without a key instead of invoking the CLI', output: 'profile', key: '', status: 0 },
])('user lookup $name', async ({ output, exitCode = 0, key = marker, status }) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-user-'))
  const privateData = `${marker} user@example.test U.example C.example Example Person`
  try {
    const smoke = join(directory, 'cli', 'smoke')
    await mkdir(smoke, { recursive: true })
    const shared = join(directory, 'packages', 'connect-common', 'src')
    await mkdir(shared, { recursive: true })
    await copyFile(
      new URL('../../packages/connect-common/src/environment.ts', import.meta.url),
      join(shared, 'environment.ts')
    )
    await copyFile(new URL('../smoke/user.mjs', import.meta.url), join(smoke, 'user.mjs'))
    await writeFile(
      join(directory, 'cli', 'cli.js'),
      `
        const assert = require('node:assert/strict')
        const fs = require('node:fs')
        assert.deepEqual(process.argv.slice(2), ['api', 'call', 'user/profile'])
        assert.ok(fs.existsSync(process.env.HOME))
        assert.equal(process.env.TERROS_IMPERSONATE, undefined)
        assert.equal(process.env.TERROS_DEBUG, undefined)
        const privateData = ${JSON.stringify(privateData)}
        fs.writeFileSync(${JSON.stringify(join(directory, 'home.txt'))}, process.env.HOME)
        const profile = {
          type: 'success',
          user: { userId: 'U.example', name: privateData, email: 'user@example.test' },
          company: { companyId: 'C.example', name: privateData }
        }
        const output = ${output}
        console.log(typeof output === 'string' ? output : JSON.stringify(output))
        console.error(privateData)
        process.exitCode = ${exitCode}
      `
    )
    const result = spawnSync(process.execPath, [join(smoke, 'user.mjs')], {
      env: {
        TERROS_API_ENDPOINT: 'https://api.terros.com',
        TERROS_API_KEY: key,
        TERROS_IMPERSONATE: 'U.example',
        TERROS_DEBUG: '1',
      },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(status)
    const logs = result.stdout + result.stderr
    for (const value of privateData.split(' ')) expect(logs).not.toContain(value)
    if (!key) {
      expect(result.stdout).toContain('SKIP:')
      await expect(readFile(join(directory, 'home.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      expect(logs).toContain(status === 0 ? 'PASS:' : 'FAIL:')
      if (status === 1) expect(result.stderr).toContain('CLI stderr: [REDACTED]')
      const home = await readFile(join(directory, 'home.txt'), 'utf8')
      expect(home).not.toBe(directory)
      await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    }
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
    const smoke = join(directory, 'cli', 'smoke')
    await mkdir(smoke, { recursive: true })
    const shared = join(directory, 'packages', 'connect-common', 'src')
    await mkdir(shared, { recursive: true })
    await copyFile(
      new URL('../../packages/connect-common/src/environment.ts', import.meta.url),
      join(shared, 'environment.ts')
    )
    await copyFile(new URL('../smoke/list.mjs', import.meta.url), join(smoke, 'list.mjs'))
    await writeFile(
      join(directory, 'cli', 'cli.js'),
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
      env: { TERROS_API_ENDPOINT: 'https://api.terros.com', TERROS_API_KEY: marker },
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

it.each([
  ['http://localhost:3000', 'TERROS_API_KEY_PORT_3000'],
  ['https://api.localhost-3000.terros.com', 'TERROS_API_KEY_STAGE_LOCALHOST_3000'],
  ['https://api.port-3000.terros.com', 'TERROS_API_KEY_STAGE_PORT_3000'],
])('user smoke passes the credential for %s to the selected backend', async (endpoint, variable) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-key-'))
  try {
    const smoke = join(directory, 'cli', 'smoke')
    const shared = join(directory, 'packages', 'connect-common', 'src')
    await mkdir(smoke, { recursive: true })
    await mkdir(shared, { recursive: true })
    await copyFile(new URL('../smoke/user.mjs', import.meta.url), join(smoke, 'user.mjs'))
    await copyFile(
      new URL('../../packages/connect-common/src/environment.ts', import.meta.url),
      join(shared, 'environment.ts')
    )
    await writeFile(
      join(directory, 'cli', 'cli.js'),
      `
      const assert = require('node:assert/strict')
      assert.equal(process.env[${JSON.stringify(variable)}], ${JSON.stringify(marker)})
      console.log(JSON.stringify({ type: 'success', user: { userId: 'U.example' }, company: { companyId: 'C.example' } }))
    `
    )
    const result = spawnSync(process.execPath, [join(smoke, 'user.mjs')], {
      env: { TERROS_API_ENDPOINT: endpoint, [variable]: marker },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('PASS:')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// A generic production key left in the shell must never be forwarded to a non-production backend by the smoke wrappers.
it('user smoke skips instead of forwarding the generic key to staging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-generic-'))
  try {
    const smoke = join(directory, 'cli', 'smoke')
    const shared = join(directory, 'packages', 'connect-common', 'src')
    await mkdir(smoke, { recursive: true })
    await mkdir(shared, { recursive: true })
    await copyFile(new URL('../smoke/user.mjs', import.meta.url), join(smoke, 'user.mjs'))
    await copyFile(
      new URL('../../packages/connect-common/src/environment.ts', import.meta.url),
      join(shared, 'environment.ts')
    )
    await writeFile(join(directory, 'cli', 'cli.js'), `process.exit(7)`)
    const result = spawnSync(process.execPath, [join(smoke, 'user.mjs')], {
      env: { TERROS_API_ENDPOINT: 'https://api.staging.terros.com', TERROS_API_KEY: marker },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('SKIP: TERROS_API_KEY_STAGE_STAGING')
    expect(result.stdout + result.stderr).not.toContain(marker)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
