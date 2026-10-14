import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, writeFileSync } from 'node:fs'
// Tests for check-public-data.mjs (TECH-5914), run by `node --test scripts/check-public-data.test.mjs` in public-data.yml. The
// denylisted name is synthetic, and the realistic IDs, emails and phone numbers are joined at run time,
// so this file itself passes the check it tests.
import { execFileSync, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const SCRIPT = join(import.meta.dirname, 'check-public-data.mjs')
const NAME = 'Zephyr Roofing'
const COMPANY_ID = ['C', 'Qx7Lp2Rk'].join('.')
const USER_ID = ['U', 'Tz4Nw8Bv1m'].join('.')
const EMAIL = ['owner', 'roofing-co.com'].join('@')
const PHONE = ['415-867', '5309'].join('-')

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'public-data-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.test')
  const commit = (file, text, message = 'Change') => {
    writeFileSync(join(dir, file), text)
    git('add', file)
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  return { dir, git, base: commit('README.md', '# Fixture\n'), commit }
}

function check(dir, args, input = '', denylist = NAME) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    cwd: dir,
    input,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_DATA_DENYLIST: denylist },
  })
  return { code: r.status, out: r.stderr }
}

test('a commit with a denylisted customer name fails, and the name is never printed', () => {
  const r = repo()
  r.commit('configFields.test.ts', `describe('zephyr roofing config', () => {})\n`)
  const { code, out } = check(r.dir, ['range', r.base, 'HEAD'])
  assert.equal(code, 1)
  assert.match(out, /configFields\.test\.ts:1: denylisted customer name/)
  assert.doesNotMatch(out, /zephyr/i)
})

test('a commit with a C. or U. ID, an email or a phone number fails', () => {
  const r = repo()
  r.commit(
    'fixture.ts',
    `const company = '${COMPANY_ID}'\nconst contact = '${EMAIL} ${PHONE}'\n`,
    `Fix the sync for ${USER_ID}`
  )
  const { code, out } = check(r.dir, ['range', r.base, 'HEAD'])
  assert.equal(code, 1)
  assert.match(out, /message:1: Terros ID/)
  assert.match(out, /fixture\.ts:1: Terros ID/)
  assert.match(out, /fixture\.ts:2: email address/)
  assert.match(out, /fixture\.ts:2: phone number/)
})

test('every Terros ID form fails: short keys, long keys, UUIDs, letters-only mixed case, either separator', () => {
  const ids = [
    ['C', 'ab12'],
    ['Program', 'Qx7Lp2Rk9Tz4Nw8Bv1m'],
    ['Account', '3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b'],
    ['U', 'QxLpRkTz'],
    ['Group', 'Tz4_Nw8'],
  ].map(([prefix, key], i) => [prefix, key].join(i % 2 ? ':' : '.'))
  for (const id of ids) {
    const r = repo()
    r.commit('ids.ts', `const id = '${id}'\n`)
    assert.match(check(r.dir, ['range', r.base, 'HEAD']).out, /ids\.ts:1: Terros ID/, id)
  }
})

test("a merge commit's message and the content it adds beyond its parents are checked", () => {
  const r = repo()
  r.git('checkout', '--quiet', '-b', 'side')
  r.commit('side.md', 'Side change\n')
  r.git('checkout', '--quiet', 'main')
  r.commit('main.md', 'Main change\n')
  r.git('merge', '--quiet', '--no-ff', '-m', 'Merge the Zephyr Roofing fix', 'side')
  const named = check(r.dir, ['range', r.base, 'HEAD'])
  assert.equal(named.code, 1)
  assert.match(named.out, /message:1: denylisted customer name/)

  // An evil merge: the ID appears only in the merge commit, not in either parent.
  const e = repo()
  e.git('checkout', '--quiet', '-b', 'side')
  e.commit('side.md', 'Side change\n')
  e.git('checkout', '--quiet', 'main')
  e.commit('main.md', 'Main change\n')
  e.git('merge', '--quiet', '--no-ff', '--no-commit', 'side')
  writeFileSync(join(e.dir, 'main.md'), `Main change for ${COMPANY_ID}\n`)
  e.git('add', 'main.md')
  e.git('commit', '--quiet', '-m', 'Merge side')
  const evil = check(e.dir, ['range', e.base, 'HEAD'])
  assert.equal(evil.code, 1)
  assert.match(evil.out, /main\.md:1: Terros ID/)
  assert.equal(check(e.dir, ['range', 'HEAD^2', 'HEAD']).code, 1)
})

test('synthetic placeholders and ordinary code pass', () => {
  const r = repo()
  r.commit(
    'fixture.ts',
    [
      `const company = { id: 'C.example', name: 'Acme Solar', rep: 'rep@example.test', phone: '(555) 555-0123' }`,
      `if (role === Role.manager || role === Role.ADMIN || Team.teamId || Program.Status) account = Account.findById(id)`,
      `const when = '2026-10-13T01:56:59.581Z', sha = '253039287a7aeee36148f3090ca39c98dab50143', owner = 'U.example-owner'`,
    ].join('\n') + '\n'
  )
  assert.deepEqual(check(r.dir, ['range', r.base, 'HEAD']), { code: 0, out: '' })
})

test('PR titles and bodies are checked', () => {
  const r = repo()
  assert.match(
    check(r.dir, ['text', 'PR body'], 'Title\n\nFixes the sync for Zephyr Roofing.\n').out,
    /PR body:3: denylisted customer name/
  )
})

test("binary files are read as text, a .gitattributes mark hides nothing, and a '++ ' line is an added line", () => {
  const r = repo()
  r.commit('logo.bin', `\0\x01PNG\nowner ${COMPANY_ID}\n\0`)
  assert.match(check(r.dir, ['range', r.base, 'HEAD']).out, /logo\.bin:2: Terros ID/)

  const a = repo()
  a.commit('.gitattributes', '*.md -diff\n')
  a.commit('notes.md', 'Zephyr Roofing\n')
  assert.match(check(a.dir, ['range', a.base, 'HEAD']).out, /notes\.md:1: denylisted customer name/)

  // An added line that starts with '++ ' shows as '+++ ' in the diff, like a file header.
  const p = repo()
  p.commit('counter.c', `int a = 1;\n++ zephyr roofing;\n++ ${COMPANY_ID};\n`)
  const { out } = check(p.dir, ['range', p.base, 'HEAD'])
  assert.match(out, /counter\.c:2: denylisted customer name/)
  assert.match(out, /counter\.c:3: Terros ID/)
})

test("a rename-only or empty file's path is checked, and a path with customer data is never printed", () => {
  const r = repo()
  r.git('mv', 'README.md', 'zephyr-roofing-notes.md')
  r.git('commit', '--quiet', '-m', 'Rename')
  const renamed = check(r.dir, ['range', r.base, 'HEAD'])
  assert.equal(renamed.code, 1)
  assert.match(renamed.out, /\(a file path with customer data\) \(file path\): denylisted customer name/)
  assert.doesNotMatch(renamed.out, /zephyr/i)

  const e = repo()
  e.commit('ZephyrRoofing.md', '')
  assert.match(check(e.dir, ['range', e.base, 'HEAD']).out, /\(file path\): denylisted customer name/)

  // A line finding in such a file does not print its path either.
  const l = repo()
  l.commit('zephyr_roofing.ts', `const id = '${COMPANY_ID}'\n`)
  const { out } = check(l.dir, ['range', l.base, 'HEAD'])
  assert.match(out, /\(a file path with customer data\):1: Terros ID/)
  assert.doesNotMatch(out, /zephyr/i)
})

test("a commit's author and committer are checked, but their own email address is not a finding", () => {
  // The environment's GIT_AUTHOR_* and GIT_COMMITTER_* would override a -c user.name, so set those.
  const commitAs = (dir, name, email) =>
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'Empty'], {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.test',
      },
    })
  const r = repo()
  commitAs(r.dir, 'Zephyr Roofing', 'rep@example.test')
  assert.match(check(r.dir, ['range', r.base, 'HEAD']).out, /author\/committer:1: denylisted customer name/)
  const e = repo()
  commitAs(e.dir, 'A Developer', EMAIL)
  assert.deepEqual(check(e.dir, ['range', e.base, 'HEAD']), { code: 0, out: '' })
})

test('a two-character denylist entry is checked in its listed case, and a one-character entry is an error', () => {
  const r = repo()
  r.commit('vendors.md', 'Parts from 3M and from Zq.\nzq is lowercase here.\n')
  const { out } = check(r.dir, ['range', r.base, 'HEAD'], '', 'Zq')
  assert.match(out, /vendors\.md:1: denylisted customer name/)
  assert.doesNotMatch(out, /vendors\.md:2:/)
  assert.equal(check(r.dir, ['range', r.base, 'HEAD'], '', '3M').code, 1)
  const bad = check(r.dir, ['range', r.base, 'HEAD'], '', 'Zephyr Roofing,Q')
  assert.equal(bad.code, 2)
  assert.doesNotMatch(bad.out, /Zephyr/)
})
