import type { TerrosApiClient } from '@terros-inc/connect-common'
import type {
  TeamAddInput,
  TeamAddSuccess,
  TeamDownlineInput,
  TeamDownlineSuccess,
  TeamGetInput,
  TeamGetSuccess,
  TeamListInput,
  TeamListSuccess,
  TeamRemoveInput,
  TeamRemoveSuccess,
  TeamUpdateInput,
  TeamUpdateSuccess,
} from '../models'

export class TeamClient {
  constructor(private readonly api: TerrosApiClient) {}

  list(input: TeamListInput = {}): Promise<TeamListSuccess> {
    return this.api.call('team/list', input)
  }

  get(input: TeamGetInput): Promise<TeamGetSuccess> {
    return this.api.call('team/get', input)
  }

  add(input: TeamAddInput): Promise<TeamAddSuccess> {
    return this.api.call('team/add', input)
  }

  update(input: TeamUpdateInput): Promise<TeamUpdateSuccess> {
    return this.api.call('team/update', input)
  }

  remove(input: TeamRemoveInput): Promise<TeamRemoveSuccess> {
    return this.api.call('team/remove', input)
  }

  downline(input: TeamDownlineInput): Promise<TeamDownlineSuccess> {
    return this.api.call('team/downline', input)
  }
}
