import { getTokens } from './oauth/tokens.ts'
import { type ApiRoute, isResponseError } from './models.ts'
import { getAnalyticsHeaders, type TerrosHeaderMetadata } from './analytics.ts'

export type TerrosClientConfig = {
  apiKey?: string
  baseUrl?: string
  analytics?: TerrosHeaderMetadata
}

const PROD_BASE_URL = 'https://api.terros.com'

export class TerrosApiClient {
  private readonly baseUrl: string
  private readonly authStrategy: AuthStrategy
  private readonly analytics: Record<string, string | undefined>

  constructor(config: TerrosClientConfig = {}) {
    this.baseUrl = this.determineBaseUrl(config)
    this.analytics = getAnalyticsHeaders(config.analytics)
    this.authStrategy = this.determineAuthStrategy(config)
  }

  async call<Success>(route: ApiRoute, input: object): Promise<Success> {
    let response: Response
    try {
      const authorization = await this.getAuthorizationHeader()
      response = await fetch(`${this.baseUrl}/${route}`, {
        method: 'POST',
        headers: {
          ...this.analytics,
          'Content-Type': 'application/json',
          authorization,
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

  private async getAuthorizationHeader(): Promise<string> {
    if (this.authStrategy.type === 'apikey') {
      return `ApiKey ${this.authStrategy.apiKey}`
    }
    const cliTokens = await getTokens()
    if (cliTokens === null)
      throw new Error(
        'No authorization found. Log in with Terros CLI or provide an API key via environment variables or client config.'
      )
    return `Bearer ${cliTokens.access_token}`
  }

  private determineAuthStrategy(config: Pick<TerrosClientConfig, 'apiKey'>): AuthStrategy {
    if (config.apiKey) return { type: 'apikey', apiKey: config.apiKey }
    const apiKeyFromEnv = readProcessEnv('TERROS_API_KEY')
    if (apiKeyFromEnv) return { type: 'apikey', apiKey: apiKeyFromEnv }
    return { type: 'oauth' }
  }

  private determineBaseUrl(config: Pick<TerrosClientConfig, 'baseUrl'>): string {
    if (config.baseUrl) return config.baseUrl
    const envEndpoint = readProcessEnv('TERROS_API_ENDPOINT')
    if (envEndpoint) return envEndpoint
    return PROD_BASE_URL
  }
}

type AuthStrategy =
  | {
      type: 'apikey'
      apiKey: string
    }
  | { type: 'oauth' }

function readProcessEnv(key: string): string | undefined {
  if (typeof globalThis.process === 'undefined') return undefined
  return globalThis.process.env[key]
}
