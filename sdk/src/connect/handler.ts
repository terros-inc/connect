import { TerrosClient } from '../client'

export type ConnectHandlerFunction<Input, Result, ScriptConfig extends ConnectScriptConfig = Record<string, string>> = (
  payload: ConnectExecutionInput<Input, ScriptConfig>,
  client: TerrosClient
) => Promise<Result>

type ConnectScriptConfigValue = string | number | boolean

type ConnectScriptConfig = Record<string, ConnectScriptConfigValue | Record<string, ConnectScriptConfigValue>>

type ConnectExecutionConfig<ScriptConfig extends ConnectScriptConfig> = {
  scriptConfig: ScriptConfig
  secrets: Record<string, string>
  authorization?: string
  authType?: 'ApiKey' | 'ConnectKey'
}

type ConnectExecutionContext<Payload, ScriptConfig extends ConnectScriptConfig> = {
  payload: Payload
  config: ConnectExecutionConfig<ScriptConfig>
}

type ConnectExecutionInput<Payload, ScriptConfig extends ConnectScriptConfig> = {
  runId: `ConnectRun.${string}`
  context: ConnectExecutionContext<Payload, ScriptConfig>
}

type WrappedHandler<Input, Result, ScriptConfig extends ConnectScriptConfig = Record<string, string>> = (
  input: ConnectExecutionInput<Input, ScriptConfig>
) => Promise<Result>

export function wrapConnectHandler<Input, Result = void, ScriptConfig extends ConnectScriptConfig = Record<string, string>>(
  handler: ConnectHandlerFunction<Input, Result, ScriptConfig>
): WrappedHandler<Input, Result, ScriptConfig> {
  return async (input) => {
    const auth = input.context.config.authorization
    const authType = input.context.config.authType
    delete input.context.config.authorization
    const client = new TerrosClient({ apiKey: auth?.replace(/^(ApiKey|ConnectKey) /, ''), authType })
    return await handler(input, client)
  }
}
