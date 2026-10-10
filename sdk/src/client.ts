import { TerrosApiClient, type TerrosClientConfig } from '@terros-inc/connect-common'
import packageJson from '../package.json'
import {
  UserClient,
  AccountClient,
  ApiHistoryClient,
  AreaClient,
  CalendarClient,
  CompanyClient,
  ConnectClient,
  TeamClient,
} from './clients'

export class TerrosClient {
  readonly account: AccountClient
  readonly apiHistory: ApiHistoryClient
  readonly area: AreaClient
  readonly calendar: CalendarClient
  readonly company: CompanyClient
  readonly connect: ConnectClient
  readonly team: TeamClient
  readonly user: UserClient

  constructor(config: TerrosClientConfig = {}) {
    const api = new TerrosApiClient({
      ...config,
      analytics: {
        'Terros-App-Version': packageJson.version,
      },
    })
    this.account = new AccountClient(api)
    this.apiHistory = new ApiHistoryClient(api)
    this.area = new AreaClient(api)
    this.calendar = new CalendarClient(api)
    this.company = new CompanyClient(api)
    this.connect = new ConnectClient(api)
    this.team = new TeamClient(api)
    this.user = new UserClient(api)
  }
}
