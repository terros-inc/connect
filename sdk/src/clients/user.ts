import {
  type UserListInput,
  type UserListSuccess,
  type UserAddInput,
  type UserAddSuccess,
  type UserUpdateInput,
  type UserUpdateSuccess,
  type UserBulkUpdateInput,
  type UserBulkUpdateSuccess,
  type UserRemoveInput,
  type UserGetInput,
  type UserGetSuccess,
  type UserProfileInput,
  type UserProfileSuccess,
  type UserSearchInput,
  type UserSearchSuccess,
  type UserTimezoneInput,
  type UserReportInput,
  type UserReportSuccess,
  type UserClosersInput,
  type UserClosersSuccess,
  type UserManagerInput,
  type UserManagerSuccess,
} from '../models'
import { type ApiSuccess, type TerrosApiClient } from '@terros-inc/connect-common'


export class UserClient {
  constructor(private readonly api: TerrosApiClient) {}

  list(input: UserListInput): Promise<UserListSuccess> {
    return this.api.call('user/list', input)
  }

  add(input: UserAddInput): Promise<UserAddSuccess> {
    return this.api.call('user/add', input)
  }

  update(input: UserUpdateInput): Promise<UserUpdateSuccess> {
    return this.api.call('user/update', input)
  }

  updateBulk(input: UserBulkUpdateInput): Promise<UserBulkUpdateSuccess> {
    return this.api.call('user/update/bulk', input)
  }

  remove(input: UserRemoveInput): Promise<ApiSuccess> {
    return this.api.call('user/remove', input)
  }

  get(input: UserGetInput = {}): Promise<UserGetSuccess> {
    return this.api.call('user/get', input)
  }

  profile(input: UserProfileInput = {}): Promise<UserProfileSuccess> {
    return this.api.call('user/profile', input)
  }

  search(input: UserSearchInput): Promise<UserSearchSuccess> {
    return this.api.call('user/search', input)
  }

  timezone(input: UserTimezoneInput): Promise<ApiSuccess> {
    return this.api.call('user/timezone', input)
  }

  report(input: UserReportInput): Promise<UserReportSuccess> {
    return this.api.call('user/report', input)
  }

  closers(input: UserClosersInput): Promise<UserClosersSuccess> {
    return this.api.call('user/closers', input)
  }

  manager(input: UserManagerInput): Promise<UserManagerSuccess> {
    return this.api.call('user/manager', input)
  }
}
