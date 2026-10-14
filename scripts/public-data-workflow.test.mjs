import { test } from 'node:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// The public-data workflow's trust boundary (TECH-5914): the customer-name denylist secret reaches only
// code from the default branch, never code a PR can change, and never a fork PR. A pull_request run takes
// its workflow file from the PR, so the secret may appear only in a pull_request_target job. This reads
// the YAML as text, job by job, so it needs no YAML parser.

const WORKFLOW = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'public-data.yml'), 'utf8')
const SECRET = 'secrets.PUBLIC_DATA_DENYLIST'

function jobs() {
  const body = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'))
  return new Map(
    body
      .split(/\n(?= {2}[\w-]+:\n)/)
      .slice(1)
      .map((block) => [/^ {2}([\w-]+):/.exec(block)?.[1], block])
  )
}

function job(name) {
  const block = jobs().get(name)
  assert.ok(block, `no job ${name}`)
  return block
}

test('only a same-repository pull_request_target job gets the denylist secret', () => {
  const withSecret = [...jobs()].filter(([, block]) => block.includes(SECRET)).map(([name]) => name)
  assert.deepEqual(withSecret, ['public-data'])
  const trusted = job('public-data')
  assert.match(
    trusted,
    /\n {4}if: \$\{\{ github\.event_name == 'pull_request_target' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}\n/
  )
  // Nothing outside the jobs (env, defaults) passes the secret on.
  assert.equal(WORKFLOW.split(SECRET).length, trusted.split(SECRET).length)
})

test('the secret-bearing job runs default-branch code and reads the PR head only as git objects', () => {
  const trusted = job('public-data')
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

test("the pull_request job runs the PR's own check with no secret", () => {
  const untrusted = job('pr-code')
  assert.match(untrusted, /\n {4}if: \$\{\{ github\.event_name == 'pull_request' \}\}\n/)
  assert.doesNotMatch(untrusted, /secrets\./)
})
