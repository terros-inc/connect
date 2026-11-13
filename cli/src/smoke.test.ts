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
  { name: 'accepts a clean auth rejection without a staging secret', code: 1, stderr: 'Unauthorized', status: 0 },
  { name: 'rejects a successful exit even with auth error text', code: 0, stderr: 'Unauthorized', status: 1 },
  { name: 'rejects an unrelated network failure', code: 1, stderr: 'fetch failed', status: 1 },
  {
    name: 'does not mistake a schema auth warning for the command failure',
    code: 1,
    stderr: 'Unable to load internal API commands: Unauthorized\nfetch failed',
    status: 1,
  },
  {
    name: 'rejects a stack trace on stderr and redacts diagnostics',
    code: 1,
    stderr: 'Unauthorized\n    at request (file:///example.js:1:2)',
    status: 1,
  },
  {
    name: 'rejects a stack trace on stdout',
    code: 1,
    stderr: 'Unauthorized',
    stdout: 'Error: Unauthorized\n    at request (file:///example.js:1:2)',
    status: 1,
  },
])('auth smoke $name', async ({ code, stderr, stdout = '', status }) => {
  const directory = await mkdtemp(join(tmpdir(), 'terros-smoke-auth-test-'))
  try {
    const smoke = join(directory, 'smoke')
    await mkdir(smoke)
    await copyFile(new URL('../smoke/auth.mjs', import.meta.url), join(smoke, 'auth.mjs'))
    await writeFile(
      join(directory, 'cli.js'),
      `
        const assert = require('node:assert/strict')
        assert.deepEqual(process.argv.slice(2), ['whoami'])
        assert.equal(process.env.TERROS_API_ENDPOINT, 'https://api.example.test')
        assert.ok(process.env.HOME)
        assert.notEqual(process.env.HOME, ${JSON.stringify(directory)})
        assert.ok(process.env.TERROS_API_KEY)
        console.error(${JSON.stringify(stderr)} + ' ' + process.env.TERROS_API_KEY)
        console.log(${JSON.stringify(stdout)} + process.env.TERROS_API_KEY)
        process.exitCode = ${code}
      `
    )
    const result = spawnSync(process.execPath, [join(smoke, 'auth.mjs')], {
      env: { TERROS_API_ENDPOINT: 'https://api.example.test' },
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
    const smoke = join(directory, 'smoke')
    await mkdir(smoke)
    await copyFile(new URL('../smoke/user.mjs', import.meta.url), join(smoke, 'user.mjs'))
    await writeFile(
      join(directory, 'cli.js'),
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
        TERROS_API_ENDPOINT: 'https://api.example.test',
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
