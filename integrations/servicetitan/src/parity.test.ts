import { installFastRetries, loadFixtures, loadGolden, replay } from './parity/replay.ts'
import { ALLOWLIST, diffResult, explain, sameResult, sequence, type AllowId } from './parity/allowlist.ts'

// Scenarios whose remaining diff is not one of A1–A17. Each entry must keep failing until the
// difference is either accepted as one of those items or the golden changes. Do not widen the allowlist
// to hide a new shape.
//
// TODO(TECH-7121): scenario 21. The fixture returns HTTP 500 once for the technician search. Legacy does
// not retry and skips. Connect retries reads, the second attempt succeeds, and the run creates a customer
// and a job. A7 is "Connect throws". A14 is a retry count on the same request list. The extra create is
// neither.
const KNOWN_FAILURES: Record<number, string> = {
  21: 'single HTTP 500 on technician search is retried, then Connect creates; legacy skips',
}

const SCENARIO_21_ACTUAL =
  'processed writes[updateAccountCustomField=1000:$job1,writeEventSourceId=1000:$job1] GET technicians x2 | GET customers | POST customers | GET locations | POST jobs'
const SCENARIO_21_GOLDEN = 'skipped writes[] GET technicians'

describe.sequential('legacy ServiceTitan parity replay', () => {
  const fixtures = loadFixtures()
  const hits = new Map<AllowId, Set<number>>()
  let restore = (): void => undefined

  beforeAll(() => {
    restore = installFastRetries()
  })

  afterAll(() => {
    restore()
    for (const entry of ALLOWLIST) {
      for (const scenario of entry.scenarios) {
        expect(hits.get(entry.id)?.has(scenario), `${entry.id} matched nothing in scenario ${scenario}`).toBe(true)
      }
    }
  })

  it('loads the thirty captured scenarios', () => {
    expect(fixtures.map((fixture) => fixture.id)).toEqual(Array.from({ length: 30 }, (_value, index) => index + 1))
  })

  for (const fixture of fixtures) {
    const known = KNOWN_FAILURES[fixture.id]
    const test = known ? it.fails : it
    test(`scenario ${fixture.id}: ${fixture.name}`, async () => {
      const actual = await replay(fixture)
      const golden = loadGolden(fixture.id)
      expect(golden.scenario).toBe(fixture.id)
      expect(golden.legacySha).toMatch(/^[0-9a-f]{40}$/)
      const explained = explain(fixture.id, actual, golden)
      for (const id of explained.matched) {
        const seen = hits.get(id) ?? new Set<number>()
        seen.add(fixture.id)
        hits.set(id, seen)
      }
      if (sameResult(explained.remaining, golden)) return
      const diffs = diffResult(golden, explained.remaining)
      throw new Error(
        [
          known ? `TODO(TECH-7121): ${known}` : `scenario ${fixture.id} (${fixture.planExpect})`,
          `actual ${sequence(actual)}`,
          `golden ${sequence(golden)}`,
          ...diffs,
        ].join('\n')
      )
    })
  }

  // it.fails above treats any throw as the expected failure. This pins the current diff so a different
  // bug in scenario 21 fails the suite on its own.
  it('scenario 21 keeps the known diff outside A1-A17', async () => {
    const fixture = fixtures.find((item) => item.id === 21)
    if (!fixture) throw new Error('missing scenario 21')
    const actual = await replay(fixture)
    const golden = loadGolden(21)
    expect(explain(21, actual, golden).matched).toEqual([])
    expect(sequence(actual)).toBe(SCENARIO_21_ACTUAL)
    expect(sequence(golden)).toBe(SCENARIO_21_GOLDEN)
  })
})
