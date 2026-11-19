import type { TerrosApiClient } from '@terros-inc/connect-common'
import type {
  PlanAddInput,
  PlanGetInput,
  PlanGetSuccess,
  PlanListInput,
  PlanListSuccess,
  PlanUpdateInput,
} from '../models'

// Without `version: 2` the API reads and writes the legacy opinion-based plan shape, which these types don't describe.
const VERSION = 2

export class PlanClient {
  constructor(private readonly api: TerrosApiClient) {}

  list(input: PlanListInput = {}): Promise<PlanListSuccess> {
    return this.api.call('plan/list', { ...input, version: VERSION })
  }

  get(input: PlanGetInput): Promise<PlanGetSuccess> {
    return this.api.call('plan/get', { ...input, version: VERSION })
  }

  add({ plan }: PlanAddInput): Promise<PlanGetSuccess> {
    // The API still requires the legacy opinion-based goals on add; version 2 plans keep their targets in stages instead.
    return this.api.call('plan/add', { plan: { ...plan, opinions: { self: { milestones: {} } } }, version: VERSION })
  }

  update(input: PlanUpdateInput): Promise<PlanGetSuccess> {
    return this.api.call('plan/update', { ...input, version: VERSION })
  }
}
