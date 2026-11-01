import type { TokenResponse } from './types.ts'
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN } from './constants.ts'

const AUTH_REQUIRED_MESSAGES = {
  expired: 'Your Terros session has expired. Run `terros auth login` to sign in again.',
  'signed-out': "You're not signed in to Terros. Run `terros auth login` to sign in.",
}

/** The user has to sign in again; its message is the whole story, so callers print it as is and never wrap it. */
export class AuthRequiredError extends Error {
  readonly reason: keyof typeof AUTH_REQUIRED_MESSAGES

  constructor(reason: keyof typeof AUTH_REQUIRED_MESSAGES) {
    super(AUTH_REQUIRED_MESSAGES[reason])
    this.name = 'AuthRequiredError'
    this.reason = reason
  }
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  let res: Response
  try {
    res = await fetch(`${AUTH0_DOMAIN}/oauth/token`, {
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
  } catch (cause) {
    throw new Error('Unable to reach Terros sign-in to refresh the session; check your connection and try again', {
      cause,
    })
  }

  if (res.ok) {
    return (await res.json()) as TokenResponse
  }

  // Only invalid_grant means the refresh token itself is dead (expired, revoked or reused); a bad client or an Auth0
  // outage would not be fixed by signing in again, so it keeps a generic message.
  const body: unknown = await res.json().catch(() => undefined)
  const error = body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (error === 'invalid_grant') throw new AuthRequiredError('expired')
  throw new Error(`Unable to refresh the Terros session: sign-in answered ${res.status}${error ? ` ${error}` : ''}`)
}
