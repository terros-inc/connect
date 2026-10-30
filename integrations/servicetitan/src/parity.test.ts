import { installFastRetries, loadFixtures, loadGolden, replay } from './parity/replay.ts'
import { ALLOWLIST, diffResult, explain, sameResult, sequence, type AllowId } from './parity/allowlist.ts'

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
    it(`scenario ${fixture.id}: ${fixture.name}`, async () => {
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
          `scenario ${fixture.id} (${fixture.planExpect})`,
          `actual ${sequence(actual)}`,
          `golden ${sequence(golden)}`,
          ...diffs,
        ].join('\n')
      )
    })
  }
})
