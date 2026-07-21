import type { TokenResponse } from './types.ts'
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN } from './constants.ts'

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(`${AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: AUTH0_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (res.ok) {
    return (await res.json()) as TokenResponse
  }

  throw new Error('Unable to refresh token, it may be expired. Run `terros auth login` to sign in again')
}
