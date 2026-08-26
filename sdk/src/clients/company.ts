import { type TerrosApiClient } from '@terros-inc/connect-common'
import type {
  CompanyAddInput,
  CompanyAddSuccess,
  CompanyGetInput,
  CompanyGetSuccess,
  CompanyListInput,
  CompanyListSuccess,
  CompanyRemoveInput,
  CompanyRemoveSuccess,
  CompanySetupInput,
  CompanySetupSuccess,
  CompanyUpdateInput,
  CompanyUpdateSuccess,
} from '../models'

export class CompanyClient {
  constructor(private readonly api: TerrosApiClient) {}

  list(input: CompanyListInput = {}): Promise<CompanyListSuccess> {
    return this.api.call('company/list', input)
  }

  get(input: CompanyGetInput = {}): Promise<CompanyGetSuccess> {
    return this.api.call('company/get', input)
  }

  add(input: CompanyAddInput): Promise<CompanyAddSuccess> {
    return this.api.call('company/add', input)
  }

  update(input: CompanyUpdateInput): Promise<CompanyUpdateSuccess> {
    return this.api.call('company/update', input)
  }

  remove(input: CompanyRemoveInput): Promise<CompanyRemoveSuccess> {
    return this.api.call('company/remove', input)
  }

  setup(input: CompanySetupInput): Promise<CompanySetupSuccess> {
    return this.api.call('company/setup', input)
  }
}
