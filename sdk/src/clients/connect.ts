import { type TerrosApiClient } from '@terros-inc/connect-common'
import type {
  ScriptAddInput,
  ScriptAddSuccess,
  VersionAddInput,
  VersionAddSuccess,
  VersionUpdateInput,
  VersionUpdateSuccess,
} from '../models'

export class ConnectAppVersionClient {
  constructor(private readonly api: TerrosApiClient) {}

  add(input: VersionAddInput): Promise<VersionAddSuccess> {
    return this.api.call('connect/app/version/add', input)
  }

  update(input: VersionUpdateInput): Promise<VersionUpdateSuccess> {
    return this.api.call('connect/app/version/update', input)
  }
}

export class ConnectScriptClient {
  constructor(private readonly api: TerrosApiClient) {}

  add(input: ScriptAddInput): Promise<ScriptAddSuccess> {
    return this.api.call('connect/script/add', input)
  }
}

export class ConnectClient {
  readonly version: ConnectAppVersionClient
  readonly script: ConnectScriptClient
  constructor(private readonly api: TerrosApiClient) {
    this.version = new ConnectAppVersionClient(api)
    this.script = new ConnectScriptClient(api)
  }
}
