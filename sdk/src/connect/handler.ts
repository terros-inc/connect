import { TerrosApiClient } from '@terros-inc/connect-common'

export type ConnectHandlerFunction<Input, Result> = (payload: ConnectExecutionInput<Input>, client: TerrosApiClient) => Promise<Result>

type ConnectExecutionConfig = {
  scriptConfig: Record<string, string> // TODO fix type of this
  secrets: Record<string, string>
  authorization?: string
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

export function wrapConnectHandler<Input, Result = void>(handler: ConnectHandlerFunction<Input, Result>): WrappedHandler<Input, Result> {
  return async (input) => {
    const apiKey = input.context.config.authorization
    delete input.context.config.authorization
    const client = new TerrosApiClient({ apiKey })
    return await handler(input, client)
  }
}
