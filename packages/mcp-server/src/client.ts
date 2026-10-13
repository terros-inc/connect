import type { ApiClient } from '@terros-inc/mcp-core'
import { isResponseError } from '@terros-inc/connect-common'

export type RequestApiClientOptions = {
  baseUrl: string
  /** The access token of the MCP request being served. */
  accessToken: string
  version: string
  fetch?: typeof fetch
}

/** An API client bound to one MCP request's caller. It never falls back to a shared key or a saved CLI login. */
export function createRequestApiClient(options: RequestApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? fetch
  return {
    async call<Success>(route: string, input: object): Promise<Success> {
      let response: Response
      try {
        response = await fetchImpl(`${options.baseUrl}/${route.replace(/^\//, '')}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.accessToken}`,
            'Content-Type': 'application/json',
            'Terros-Bundle-Identifier': 'com.terros.mcp',
            'Terros-Platform-Version': options.version,
          },
          body: JSON.stringify(input),
        })
      } catch (cause) {
        throw new Error(`Request to ${route} failed`, { cause })
      }
      if (!response.ok) throw new Error(response.statusText || `Request to ${route} failed (${response.status})`)
      const output: unknown = await response.json()
      if (isResponseError(output)) throw new Error(output.message ?? output.error)
      return output as Success
    },
  }
}
