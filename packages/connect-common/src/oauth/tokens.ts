import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
import type { SavedTokens, TokenResponse } from './types.ts'
import { AuthRequiredError, refreshTokens } from './auth0.ts'

const AUTH_DIR_MODE = 0o700
const AUTH_FILE_MODE = 0o600
const SECOND = 1000
const MINUTE = 60 * SECOND

let pendingRefresh: Promise<SavedTokens> | undefined
let deadRefreshToken: string | undefined

export async function getTokens(): Promise<SavedTokens | null> {
  const tokens = await readTokens()
  if (tokens === null) {
    return null
  }
  if (areTokensValid(tokens)) return tokens
  // A refresh token Auth0 rejected stays rejected, so a later caller in the same process (the command's own request
  // after the schema load) fails without sending it again. Other failures may be transient and are retried.
  if (tokens.refresh_token === deadRefreshToken) throw new AuthRequiredError('expired')
  // Refresh tokens rotate: concurrent calls in one process share a single refresh, so a second refresh can't
  // spend the already-replaced token and overwrite auth.json with a login that no longer works.
  pendingRefresh ??= refreshTokens(tokens.refresh_token)
    .then(saveTokens)
    .catch((error: unknown) => {
      if (error instanceof AuthRequiredError) deadRefreshToken = tokens.refresh_token
      throw error
    })
    .finally(() => {
      pendingRefresh = undefined
    })
  return await pendingRefresh
}

function areTokensValid(tokens: SavedTokens): boolean {
  return tokens.expires_at > Date.now() + MINUTE * 5
}

async function readTokens(): Promise<SavedTokens | null> {
  try {
    const path = await getAuthFilePath()
    const file = await readFile(path, 'utf-8')
    return JSON.parse(file)
  } catch (e) {
    return null
  }
}

export async function saveTokens(tokenResponse: TokenResponse): Promise<SavedTokens> {
  const expiresAt = Date.now() + tokenResponse.expires_in * SECOND

  const savedTokens: SavedTokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    id_token: tokenResponse.id_token,
    token_type: tokenResponse.token_type,
    expires_at: expiresAt,
  }

  const authFile = await getAuthFilePath()
  await writeFile(authFile, JSON.stringify(savedTokens), { mode: AUTH_FILE_MODE })
  await chmod(authFile, AUTH_FILE_MODE)
  return savedTokens
}

async function getAuthFilePath(): Promise<string> {
  const home = homedir()
  const configPath = join(home, '.config', 'terros')
  await mkdir(configPath, { recursive: true, mode: AUTH_DIR_MODE })
  await chmod(configPath, AUTH_DIR_MODE)
  return join(configPath, 'auth.json')
}
