import { UserClient, AccountClient, CalendarClient, ConnectClient } from './clients'
import { ApiCaller, type ClientConfig } from './apiCaller'

export class TerrosClient {
  readonly account: AccountClient
  readonly calendar: CalendarClient
  readonly connect: ConnectClient
  readonly user: UserClient

  constructor(config: ClientConfig = {}) {
    const api = new ApiCaller(config)
    this.account = new AccountClient(api)
    this.calendar = new CalendarClient(api)
    this.connect = new ConnectClient(api)
    this.user = new UserClient(api)
  }
}
