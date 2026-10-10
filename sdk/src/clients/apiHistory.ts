import { type TerrosApiClient } from '@terros-inc/connect-common'
import type { ApiHistoryListInput, ApiHistoryListSuccess } from '../models'

export class ApiHistoryClient {
  constructor(private readonly api: TerrosApiClient) {}

  list(input: ApiHistoryListInput): Promise<ApiHistoryListSuccess> {
    return this.api.call('apiHistory/list', input)
  }
}
