import { getTokens } from './oauth/tokens.ts'
import { AuthRequiredError } from './oauth/auth0.ts'
import { type ApiRoute, isResponseError, TerrosApiError } from './models.ts'
import { environmentApiKey, resolveEnvironment } from './environment.ts'
import { getAnalyticsHeaders, type TerrosHeaderMetadata } from './analytics.ts'

export type TerrosClientConfig = {
  apiKey?: string
  authType?: 'ApiKey' | 'ConnectKey'
  baseUrl?: string
  analytics?: TerrosHeaderMetadata
  /** The user to act as; defaults to `TERROS_IMPERSONATE`. An empty string acts as the signed-in user. */
  impersonateUserId?: string
  /**
   * A sign-in token to send instead of an API key or the saved login, for one request that needs a scope the saved
   * login lacks. It is never saved.
   */
  accessToken?: string
}

export class TerrosApiClient {
  private readonly baseUrl: string
  private readonly stateDir: string
  private readonly authStrategy: AuthStrategy
  private readonly analytics: Record<string, string | undefined>
  private readonly impersonateUserId: string | undefined

  constructor(config: TerrosClientConfig = {}) {
    const environment = config.baseUrl
      ? resolveEnvironment({ TERROS_API_ENDPOINT: config.baseUrl })
      : resolveEnvironment()
    this.baseUrl = environment.baseUrl
    this.stateDir = environment.stateDir
    this.analytics = getAnalyticsHeaders(config.analytics)
    this.authStrategy = this.determineAuthStrategy(config, environment)
    this.impersonateUserId = config.impersonateUserId ?? readProcessEnv('TERROS_IMPERSONATE')
  }

  async call<Success>(route: ApiRoute, input: object): Promise<Success> {
    return this.request(route, 'POST', input)
  }

  async get<Success>(route: ApiRoute): Promise<Success> {
    return this.request(route, 'GET')
  }

  private async request<Success>(route: ApiRoute, method: 'GET' | 'POST', input?: object): Promise<Success> {
    let response: Response
    try {
      const authorization = await this.getAuthorizationHeader()
      const headers: Record<string, string | undefined> = {
        ...this.analytics,
        'Content-Type': 'application/json',
        authorization,
      }
      if (this.impersonateUserId) headers.impersonate_user_id = this.impersonateUserId

      response = await fetch(`${this.baseUrl}/${route.replace(/^\//, '')}`, {
        method,
        headers,
        body: JSON.stringify(input),
      })
    } catch (cause) {
      if (cause instanceof AuthRequiredError) throw cause
      throw new Error(`Request to ${route} failed: ${cause instanceof Error ? cause.message : cause}`, { cause })
    }
    if (!response.ok) {
      const message =
        this.authStrategy.type === 'apikey' && (response.status === 401 || response.status === 403)
          ? 'Invalid or unauthorized API key'
          : response.statusText
      throw Object.assign(new Error(message), { status: response.status })
    }
    const output: unknown = await response.json()
    if (isResponseError(output)) throw new TerrosApiError(output)
    return output as Success
  }

  private async getAuthorizationHeader(): Promise<string> {
    if (this.authStrategy.type === 'apikey') {
      return `${this.authStrategy.authType} ${this.authStrategy.apiKey}`
    }
    if (this.authStrategy.type === 'bearer') return `Bearer ${this.authStrategy.accessToken}`
    const cliTokens = await getTokens(this.stateDir)
    if (cliTokens === null) throw new AuthRequiredError('signed-out')
    return `Bearer ${cliTokens.access_token}`
  }

  private determineAuthStrategy(
    config: Pick<TerrosClientConfig, 'apiKey' | 'authType' | 'accessToken'>,
    environment: ReturnType<typeof resolveEnvironment>
  ): AuthStrategy {
    if (config.accessToken) return { type: 'bearer', accessToken: config.accessToken }
    const authType = config.authType ?? 'ApiKey'
    if (config.apiKey) return { type: 'apikey', apiKey: config.apiKey, authType }
    const apiKeyFromEnv = environmentApiKey(environment)
    if (apiKeyFromEnv) return { type: 'apikey', apiKey: apiKeyFromEnv, authType }
    return { type: 'oauth' }
  }
}

type AuthStrategy =
  | {
      type: 'apikey'
      apiKey: string
      authType: 'ApiKey' | 'ConnectKey'
    }
  | { type: 'bearer'; accessToken: string }
  | { type: 'oauth' }

function readProcessEnv(key: string): string | undefined {
  if (typeof globalThis.process === 'undefined') return undefined
  return globalThis.process.env[key]
}
