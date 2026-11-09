import open from 'open'
import { DateTime } from 'luxon'
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN, type TokenResponse } from '@terros-inc/connect-common/auth'
import type { DeviceCodeResponse } from './types'

/** The API refuses to issue an API key unless the sign-in token grants this scope. */
const SENSITIVE_MANAGE_SCOPE = 'sensitive:manage'

export async function signInToAuth0(
  scope = 'offline_access',
  log: (message: string) => void = console.log
): Promise<TokenResponse> {
  const res = await fetch(`${AUTH0_DOMAIN}/oauth/device/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: AUTH0_CLIENT_ID,
      scope,
    }),
  })

  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
    throw new Error(
      `Failed to get OAuth device code: ${error.error_description || error.error || `HTTP ${res.status}`}`
    )
  }
  const body = (await res.json()) as DeviceCodeResponse

  const deadline = DateTime.now().plus({ seconds: body.expires_in })

  // Open the page without the code: a link with the code pre-filled lets anyone who sends it to a user get their
  // sign-in approved with one click, so the user must type the code from their own terminal.
  log(`To sign in, enter this code on the Terros sign-in page:\n\n    ${body.user_code}\n`)
  log('Only approve a sign-in you started yourself. Never enter a code someone else sent you.')
  try {
    await open(body.verification_uri)
    log(`If your browser did not open, visit ${body.verification_uri}`)
  } catch {
    log(`Visit ${body.verification_uri} in your browser`)
  }

  return await pollForToken(deadline, body.interval, body.device_code)
}

/**
 * Sign in again for a token that grants SENSITIVE_MANAGE_SCOPE, for one request. The saved login asks only for
 * offline_access, so this token is kept in memory and never saved, and without offline_access it gets no refresh token.
 * Prompts go to standard error so standard output carries only the command's response, which is often piped into a
 * secret store.
 */
export async function signInWithSensitiveScope(): Promise<string> {
  console.error(`This command needs a fresh sign-in that grants the ${SENSITIVE_MANAGE_SCOPE} scope.`)
  let tokens: TokenResponse
  try {
    tokens = await signInToAuth0(SENSITIVE_MANAGE_SCOPE, console.error)
  } catch (cause) {
    throw new Error(
      `Sign-in for the ${SENSITIVE_MANAGE_SCOPE} scope failed: ${cause instanceof Error ? cause.message : cause}`,
      { cause }
    )
  }
  // Auth0 can leave a requested scope out of the token (by API or user policy) rather than refuse the sign-in, and the
  // API would then refuse the request without saying why, so the granted scope is checked here.
  if (!grantedScopes(tokens.access_token).includes(SENSITIVE_MANAGE_SCOPE)) {
    throw new Error(
      `Sign-in did not grant the ${SENSITIVE_MANAGE_SCOPE} scope, which this command needs. The Terros CLI's Auth0 ` +
        `application must be allowed to request ${SENSITIVE_MANAGE_SCOPE} in the Auth0 tenant.`
    )
  }
  return tokens.access_token
}

function grantedScopes(accessToken: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString()) as {
      scope?: unknown
    }
    return typeof payload.scope === 'string' ? payload.scope.split(' ') : []
  } catch {
    return []
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000)
  })
}

export async function pollForToken(deadline: DateTime, interval: number, deviceCode: string): Promise<TokenResponse> {
  await sleep(interval)
  if (deadline < DateTime.now()) throw new Error('Token was not approved in time')
  const res = await fetch(`${AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: AUTH0_CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
    if (body.error === 'authorization_pending') return pollForToken(deadline, interval, deviceCode)
    // RFC 8628: on slow_down, add 5 seconds to the polling interval
    if (body.error === 'slow_down') return pollForToken(deadline, interval + 5, deviceCode)
    const reason = body.error_description || body.error || `HTTP ${res.status}`
    if (body.error === 'access_denied') throw new Error(`Sign-in denied: ${reason}`)
    throw new Error(`Sign-in failed: ${reason}`)
  }
  return (await res.json()) as TokenResponse
}
