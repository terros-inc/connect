import {
  type AccountStatusAddInput,
  type AccountStatusAddSuccess,
  type AccountStatusUpdateInput,
  type AccountStatusUpdateSuccess,
  type AccountStatusListInput,
  type AccountStatusListSuccess,
  type AccountStatusRemoveInput,
  type ApiSuccess,
  type AccountAddInput,
  type AccountAddSuccess,
  type AccountUpdateInput,
  type AccountUpdateSuccess,
  type AccountUpdateBatchInput,
  type AccountUpdateBatchSuccess,
  type AccountListInput,
  type AccountListSuccess,
  type BulkModifyAccountsInput,
  type AccountGetInput,
  type AccountGetSuccess,
  type AccountMatchInput,
  type AccountMatchSuccess,
  type AccountRemoveInput,
  type AccountUpsertInput,
  type AccountUpsertSuccess,
} from '../models'
import { type ApiCaller } from '../apiCaller'

export class AccountStatusClient {
  constructor(private readonly api: ApiCaller) {}

  add(input: AccountStatusAddInput): Promise<AccountStatusAddSuccess> {
    return this.api.call('account/status/add', input)
  }

  update(input: AccountStatusUpdateInput): Promise<AccountStatusUpdateSuccess> {
    return this.api.call('account/status/update', input)
  }

  list(input: AccountStatusListInput): Promise<AccountStatusListSuccess> {
    return this.api.call('account/status/list', input)
  }

  remove(input: AccountStatusRemoveInput): Promise<ApiSuccess> {
    return this.api.call('account/status/remove', input)
  }
}

export class AccountClient {
  readonly status: AccountStatusClient

  constructor(private readonly api: ApiCaller) {
    this.status = new AccountStatusClient(api)
  }

  add(input: AccountAddInput): Promise<AccountAddSuccess> {
    return this.api.call('account/add', input)
  }

  update(input: AccountUpdateInput): Promise<AccountUpdateSuccess> {
    return this.api.call('account/update', input)
  }

  updateBatch(input: AccountUpdateBatchInput): Promise<AccountUpdateBatchSuccess> {
    return this.api.call('account/update/batch', input)
  }

  list(input: AccountListInput): Promise<AccountListSuccess> {
    return this.api.call('account/list', input)
  }

  bulk(input: BulkModifyAccountsInput): Promise<ApiSuccess> {
    return this.api.call('account/bulk', input)
  }

  get(input: AccountGetInput): Promise<AccountGetSuccess> {
    return this.api.call('account/get', input)
  }

  match(input: AccountMatchInput): Promise<AccountMatchSuccess> {
    return this.api.call('account/match', input)
  }

  remove(input: AccountRemoveInput): Promise<ApiSuccess> {
    return this.api.call('account/remove', input)
  }

  upsert(input: AccountUpsertInput): Promise<AccountUpsertSuccess> {
    return this.api.call('account/upsert', input)
  }
}
