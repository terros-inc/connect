import { test } from 'node:test'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// The public-data workflows' trust boundary (TECH-5914): the customer-name denylist secret reaches only
// code from the default branch, never code a PR can change, and never a fork PR. A pull_request run takes
// its workflow file from the PR, so the secret may appear only in a pull_request_target workflow. This
// reads the YAML as text, so it needs no YAML parser.

const DIR = join(import.meta.dirname, '..', '.github', 'workflows')
const read = (file) => readFileSync(join(DIR, file), 'utf8')
const SECRET = 'secrets.PUBLIC_DATA_DENYLIST'
const triggers = (workflow) =>
  [...(/\non:\n((?: {2}.*\n)+)/.exec(workflow)?.[1] ?? '').matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])

test('only the pull_request_target workflow, for same-repository PRs, gets the denylist secret', () => {
  const withSecret = readdirSync(DIR).filter((file) => read(file).includes(SECRET))
  assert.deepEqual(withSecret, ['public-data-trusted.yml'])
  const trusted = read('public-data-trusted.yml')
  assert.deepEqual(triggers(trusted), ['pull_request_target'])
  assert.deepEqual(trusted.slice(trusted.indexOf('\njobs:\n')).match(/\n {2}[\w-]+:\n/g), ['\n  public-data:\n'])
  assert.match(
    trusted,
    /\n {4}if: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}\n/
  )
})

test('the secret-bearing job runs default-branch code and reads the PR head only as git objects', () => {
  const trusted = read('public-data-trusted.yml')
  const checkouts = trusted.split('uses: actions/checkout@').slice(1)
  assert.equal(checkouts.length, 1)
  assert.match(checkouts[0], /\n {10}ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n/)
  assert.match(checkouts[0], /\n {10}persist-credentials: false\n/)
  // No checkout, working directory, install or other action that would put PR files on disk or run them.
  assert.doesNotMatch(
    trusted,
    /working-directory|pnpm|npm |npx|corepack|git (checkout|switch|reset|worktree|merge|cherry-pick)/
  )
  assert.deepEqual(
    [...trusted.matchAll(/uses: ([^@\s]+)@/g)].map((m) => m[1]),
    ['actions/checkout', 'actions/setup-node']
  )
  // Every command is the fetch or the default branch's check script.
  const runs = [...trusted.matchAll(/\n {8}run: (.*)/g)].map((m) => m[1])
  assert.equal(runs.length, 3)
  assert.equal(runs[0], 'git fetch --no-tags --quiet origin "$BASE" "$HEAD"')
  assert.equal(runs[1], 'node scripts/check-public-data.mjs range "$BASE" "$HEAD"')
  assert.match(runs[2], /^printf .* \| node scripts\/check-public-data\.mjs text "branch, PR title and body"$/)
})

test("the pull_request workflow runs the PR's own check with no secret", () => {
  const untrusted = read('public-data.yml')
  assert.deepEqual(triggers(untrusted), ['pull_request'])
  assert.doesNotMatch(untrusted, /secrets\./)
})
