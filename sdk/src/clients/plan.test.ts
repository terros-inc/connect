import type { TerrosApiClient } from '@terros-inc/connect-common'
import { PlanClient } from './plan'

describe('PlanClient.add', () => {
  // The /plan/add request schema requires `plan.opinions.self.milestones`, which the SDK plan types leave out, so
  // without it every type-correct add fails as InvalidRequest.
  it('sends the empty legacy opinions the API requires, with version 2', async () => {
    const calls: [string, object][] = []
    const api = {
      call: async (route: string, input: object) => {
        calls.push([route, input])
        return { type: 'success' }
      },
    } as unknown as TerrosApiClient

    await new PlanClient(api).add({
      plan: {
        scope: 'team',
        scopeId: 'Team.example',
        periodType: 'quarter',
        period: 'Q2026|4',
        status: 'Submitted',
        days: [],
        selfgen: [{ milestone: 'Installed', stageId: 'S.installed', conversionRate: 1, quantityRequired: 125 }],
      },
    })

    expect(calls).toEqual([
      [
        'plan/add',
        {
          version: 2,
          plan: {
            scope: 'team',
            scopeId: 'Team.example',
            periodType: 'quarter',
            period: 'Q2026|4',
            status: 'Submitted',
            days: [],
            selfgen: [{ milestone: 'Installed', stageId: 'S.installed', conversionRate: 1, quantityRequired: 125 }],
            opinions: { self: { milestones: {} } },
          },
        },
      ],
    ])
  })
})
