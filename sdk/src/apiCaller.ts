import { type ApiRoute, isResponseError } from './models'
import { getAnalyticsHeaders } from './analytics'

export type ClientConfig = {
  apiKey?: string
  baseUrl?: string
}

const PROD_BASE_URL = 'https://api.terros.com'

export class ApiCaller {
  private readonly baseUrl: string
  private readonly auth: string
  private readonly analytics: Record<string, string | undefined>

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl ?? readProcessEnv('TERROS_SDK_BASE_URL') ?? PROD_BASE_URL
    this.analytics = getAnalyticsHeaders()
    const auth = config.apiKey ?? readProcessEnv('TERROS_API_KEY')
    if (!auth) throw new Error('No auth provided: set TERROS_API_KEY or pass config.auth')
    this.auth = auth
  }

  async call<Success>(route: ApiRoute, input: object): Promise<Success> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/${route}`, {
        method: 'POST',
        headers: {
          ...this.analytics,
          'Content-Type': 'application/json',
          authorization: `ApiKey ${this.auth}`,
        },
        body: JSON.stringify(input),
      })
    } catch (cause) {
      throw new Error(`Request to ${route} failed`, { cause })
    }
    if (!response.ok) throw new Error(response.statusText)
    const output: unknown = await response.json()
    if (isResponseError(output)) throw new Error(output.message ?? output.error)
    return output as Success
  }
}

function readProcessEnv(key: string): string | undefined {
  if (typeof globalThis.process === 'undefined') return undefined
  return globalThis.process.env[key]
}
