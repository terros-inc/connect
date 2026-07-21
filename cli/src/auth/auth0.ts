import open from 'open'
import { DateTime } from 'luxon'
import type { DeviceCodeResponse, TokenResponse } from './types'
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN } from './constants'

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

  await open(body.verification_uri_complete)
  console.log(`Confirm that the code in your browser matches: ${body.user_code}`)
  console.log(`If your browser did not open, visit ${body.verification_uri} and enter the code`)

  return await pollForToken(deadline, body.interval, body.device_code)
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000)
  })
}

async function pollForToken(deadline: DateTime, interval: number, deviceCode: string): Promise<TokenResponse> {
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
    const body = (await res.json()) as { error: string; error_description: string }
    if (body.error === 'access_denied') throw new Error('Authorization request denied')
    return pollForToken(deadline, interval, deviceCode)
  }
  return (await res.json()) as TokenResponse
}

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
