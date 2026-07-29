import { TerrosApiClient, type TerrosClientConfig } from '@terros-inc/connect-common'
import packageJson from '../package.json'
import { UserClient, AccountClient, AreaClient, CalendarClient, ConnectClient } from './clients'

export class TerrosClient {
  readonly account: AccountClient
  readonly area: AreaClient
  readonly calendar: CalendarClient
  readonly connect: ConnectClient
  readonly user: UserClient

  constructor(config: TerrosClientConfig = {}) {
    const api = new TerrosApiClient({
      ...config,
      analytics: {
        'Terros-App-Version': packageJson.version,
      },
    })
    this.account = new AccountClient(api)
    this.area = new AreaClient(api)
    this.calendar = new CalendarClient(api)
    this.connect = new ConnectClient(api)
    this.user = new UserClient(api)
  }
}
