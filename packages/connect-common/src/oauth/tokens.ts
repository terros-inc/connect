import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile, readFile, chmod, rename, rm, stat } from 'node:fs/promises'
import type { SavedTokens, TokenResponse } from './types.ts'
import { refreshTokens } from './auth0.ts'

const AUTH_DIR_MODE = 0o700
const AUTH_FILE_MODE = 0o600
const SECOND = 1000
const MINUTE = 60 * SECOND
const LOCK_RETRY_MS = 50
// A refresh takes well under a second, so an older lock was left by a process that hung or was killed mid-refresh.
const STALE_LOCK_MS = 30 * SECOND

let pendingRefresh: Promise<SavedTokens | null> | undefined

export async function getTokens(): Promise<SavedTokens | null> {
  const tokens = await readTokens()
  if (tokens === null) {
    return null
  }
  if (areTokensValid(tokens)) return tokens
  // Refresh tokens rotate and Auth0 revokes the whole login when one is sent twice, so callers in this process share
  // one refresh, and that refresh re-reads auth.json under a lock shared with other terros processes.
  pendingRefresh ??= refreshSavedTokens().finally(() => {
    pendingRefresh = undefined
  })
  return await pendingRefresh
}

async function refreshSavedTokens(): Promise<SavedTokens | null> {
  const authFile = await getAuthFilePath()
  const unlock = await lockAuthFile(authFile)
  try {
    // A caller that read auth.json before another refresh saved would otherwise send the already-spent token.
    const tokens = await readTokens()
    if (tokens === null || areTokensValid(tokens)) return tokens
    if (tokens.refresh_token === undefined) return null
    const response = await refreshTokens(tokens.refresh_token)
    // Auth0 omits refresh_token when rotation is off, and then the saved one stays valid.
    return await saveTokens({ ...response, refresh_token: response.refresh_token ?? tokens.refresh_token })
  } finally {
    await unlock()
  }
}

async function lockAuthFile(authFile: string): Promise<() => Promise<void>> {
  const lockFile = `${authFile}.lock`
  for (;;) {
    try {
      await writeFile(lockFile, String(process.pid), { flag: 'wx', mode: AUTH_FILE_MODE })
      return () => rm(lockFile, { force: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    if (await isLockStale(lockFile)) await rm(lockFile, { force: true })
    else await sleep(LOCK_RETRY_MS)
  }
}

async function isLockStale(lockFile: string): Promise<boolean> {
  try {
    const [holder, info] = await Promise.all([readFile(lockFile, 'utf-8'), stat(lockFile)])
    return Date.now() - info.mtimeMs > STALE_LOCK_MS || !isProcessRunning(Number(holder))
  } catch {
    return false
  }
}

function isProcessRunning(pid: number): boolean {
  // An empty lock was just created and its pid is not written yet; only its age can make it stale.
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
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

  // Write and rename so a crash or a concurrent reader never sees a partial auth.json and loses the rotated token.
  const authFile = await getAuthFilePath()
  const tempFile = `${authFile}.${process.pid}.tmp`
  try {
    await writeFile(tempFile, JSON.stringify(savedTokens), { mode: AUTH_FILE_MODE })
    await chmod(tempFile, AUTH_FILE_MODE)
    await rename(tempFile, authFile)
  } catch (e) {
    await rm(tempFile, { force: true })
    throw e
  }
  return savedTokens
}

async function getAuthFilePath(): Promise<string> {
  const home = homedir()
  const configPath = join(home, '.config', 'terros')
  await mkdir(configPath, { recursive: true, mode: AUTH_DIR_MODE })
  await chmod(configPath, AUTH_DIR_MODE)
  return join(configPath, 'auth.json')
}
