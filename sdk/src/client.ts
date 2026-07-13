import { UserClient, AccountClient, CalendarClient } from './clients'
import { ApiCaller, type ClientConfig } from './apiCaller'

export class TerrosClient {
  readonly user: UserClient
  readonly account: AccountClient
  readonly calendar: CalendarClient

  constructor(config: ClientConfig) {
    const api = new ApiCaller(config)
    this.user = new UserClient(api)
    this.account = new AccountClient(api)
    this.calendar = new CalendarClient(api)
  }
}
