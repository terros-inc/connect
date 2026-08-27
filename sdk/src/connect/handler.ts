import { TerrosClient } from '../client'

export type ConnectHandlerFunction<Input, Result> = (
  payload: ConnectExecutionInput<Input>,
  client: TerrosClient
) => Promise<Result>

type ConnectExecutionConfig = {
  scriptConfig: Record<string, string> // TODO fix type of this
  secrets: Record<string, string>
  authorization?: string
  authType?: 'ApiKey' | 'ConnectKey'
}

type ConnectExecutionContext<Payload> = {
  payload: Payload
  config: ConnectExecutionConfig
}

type ConnectExecutionInput<Payload> = {
  runId: `ConnectRun.${string}`
  context: ConnectExecutionContext<Payload>
}

type WrappedHandler<Input, Result> = (input: ConnectExecutionInput<Input>) => Promise<Result>

export function wrapConnectHandler<Input, Result = void>(
  handler: ConnectHandlerFunction<Input, Result>
): WrappedHandler<Input, Result> {
  return async (input) => {
    const auth = input.context.config.authorization
    const authType = input.context.config.authType
    delete input.context.config.authorization
    const client = new TerrosClient({ apiKey: auth?.replace(/^(ApiKey|ConnectKey) /, ''), authType })
    return await handler(input, client)
  }
}
