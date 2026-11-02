import open from 'open'
import { DateTime } from 'luxon'
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN, type TokenResponse } from '@terros-inc/connect-common/auth'
import type { DeviceCodeResponse } from './types'

export async function signInToAuth0(): Promise<TokenResponse> {
  const res = await fetch(`${AUTH0_DOMAIN}/oauth/device/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: AUTH0_CLIENT_ID,
      scope: 'offline_access',
    }),
  })

  if (!res.ok) throw new Error('Failed to get OAuth device code')
  const body = (await res.json()) as DeviceCodeResponse

  const deadline = DateTime.now().plus({ seconds: body.expires_in })

  // Open the page without the code: a link with the code pre-filled lets anyone who sends it to a user get their
  // sign-in approved with one click, so the user must type the code from their own terminal.
  console.log(`To sign in, enter this code on the Terros sign-in page:\n\n    ${body.user_code}\n`)
  console.log('Only approve a sign-in you started yourself. Never enter a code someone else sent you.')
  try {
    await open(body.verification_uri)
    console.log(`If your browser did not open, visit ${body.verification_uri}`)
  } catch {
    console.log(`Visit ${body.verification_uri} in your browser`)
  }

  return await pollForToken(deadline, body.interval, body.device_code)
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
