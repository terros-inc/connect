import { type TerrosApiClient } from '@terros-inc/connect-common'
import type {
  ApiHistoryStartInput,
  ApiHistoryStartSuccess,
  ApiHistoryStatusInput,
  ApiHistoryStatusSuccess,
} from '../models'

export class ApiHistoryClient {
  constructor(private readonly api: TerrosApiClient) {}

  start(input: ApiHistoryStartInput): Promise<ApiHistoryStartSuccess> {
    return this.api.call('apiHistory/start', input)
  }

  status(input: ApiHistoryStatusInput): Promise<ApiHistoryStatusSuccess> {
    return this.api.call('apiHistory/status', input)
  }
}
