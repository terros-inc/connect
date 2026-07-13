import { getTokens } from '../auth/tokens.ts'

const API_KEY_ENV = 'TERROS_API_KEY'

export async function getAuthorizationHeader(): Promise<string> {
  const apiKeyEnv = process.env[API_KEY_ENV]
  if (apiKeyEnv) {
    return `ApiKey ${apiKeyEnv}`
  }

  const tokens = await getTokens()
  if (tokens !== null) {
    return `Bearer ${tokens.access_token}`
  }

  throw new Error(
    `CLI not authorized. Run \`terros auth login\` to authenticate or provide an API key in the \`${API_KEY_ENV}\` environment variable.`
  )
}
