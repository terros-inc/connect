import { type ApiSuccess, type TerrosApiClient } from '@terros-inc/connect-common'
import {
  type AreaAddInput,
  type AreaAddSuccess,
  type AreaAssignInput,
  type AreaGetInput,
  type AreaGetSuccess,
  type AreaListInput,
  type AreaListSuccess,
  type AreaRemoveInput,
  type AreaUpdateInput,
  type AreaUpdateSuccess,
} from '../models'

export class AreaClient {
  constructor(private readonly api: TerrosApiClient) {}

  list(input: AreaListInput): Promise<AreaListSuccess> {
    return this.api.call('area/list', input)
  }

  get(input: AreaGetInput): Promise<AreaGetSuccess> {
    return this.api.call('area/get', input)
  }

  add(input: AreaAddInput): Promise<AreaAddSuccess> {
    return this.api.call('area/add', input)
  }

  update(input: AreaUpdateInput): Promise<AreaUpdateSuccess> {
    return this.api.call('area/update', input)
  }

  remove(input: AreaRemoveInput): Promise<ApiSuccess> {
    return this.api.call('area/remove', input)
  }

  assign(input: AreaAssignInput): Promise<ApiSuccess> {
    return this.api.call('area/assign', input)
  }
}
