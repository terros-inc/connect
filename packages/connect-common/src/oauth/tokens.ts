import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile, readFile, chmod, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { SavedTokens, TokenResponse } from './types.ts'
import { refreshTokens } from './auth0.ts'

const AUTH_DIR_MODE = 0o700
const AUTH_FILE_MODE = 0o600
const SECOND = 1000
const MINUTE = 60 * SECOND
const LOCK_RETRY_MS = 50
// Sending the token while another process may still be refreshing could revoke the login, so a waiter gives up instead.
const LOCK_TIMEOUT_MS = MINUTE

let pendingRefresh: Promise<SavedTokens | null> | undefined

export async function getTokens(): Promise<SavedTokens | null> {
  const tokens = await readTokens()
  if (tokens === null) {
    return null
  }
  if (areTokensValid(tokens)) return tokens
  // Refresh tokens rotate and Auth0 revokes the whole login when one is sent twice, so callers in this process share
  // one refresh, and that refresh re-reads auth.json under a lock shared with other terros processes.
  pendingRefresh ??= withAuthLock(refreshSavedTokens).finally(() => {
    pendingRefresh = undefined
  })
  return await pendingRefresh
}

async function refreshSavedTokens(): Promise<SavedTokens | null> {
  // A caller that read auth.json before another refresh saved would otherwise send the already-spent token.
  const tokens = await readTokens()
  if (tokens === null || areTokensValid(tokens)) return tokens
  if (tokens.refresh_token === undefined) return null
  const response = await refreshTokens(tokens.refresh_token)
  // Auth0 omits refresh_token when rotation is off, and then the saved one stays valid.
  return await writeTokens({ ...response, refresh_token: response.refresh_token ?? tokens.refresh_token })
}

async function withAuthLock<T>(run: () => Promise<T>): Promise<T> {
  const lockFile = `${await getAuthFilePath()}.lock`
  const owner = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (!(await tryLock(lockFile, owner))) {
    // A dead holder whose pid was reused looks alive; the path lets the user clear that lock by hand.
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for another terros command to renew the sign-in (lock file: ${lockFile})`)
    }
    await sleep(LOCK_RETRY_MS)
  }
  try {
    return await run()
  } finally {
    await removeLock(lockFile, owner)
  }
}

// A lock is never taken from a running process, whatever its age: its refresh may still be in flight.
async function tryLock(lockFile: string, owner: string): Promise<boolean> {
  try {
    await writeFile(lockFile, owner, { flag: 'wx', mode: AUTH_FILE_MODE })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  const holder = await readFile(lockFile, 'utf-8').catch(() => null)
  if (holder !== null && isDeadOwner(holder)) await removeDeadLock(lockFile, holder)
  return false
}

// Checking that the lock still names the dead holder and removing it are two steps, so only the process that creates
// this holder's guard file runs them; otherwise a second taker could delete the lock the first had just taken. A guard
// left by a killed taker is itself a dead lock and is taken over the same way.
async function removeDeadLock(lockFile: string, holder: string): Promise<void> {
  const guard = `${lockFile}.${holder.split(':')[1]}`
  if (!(await tryLock(guard, `${process.pid}:${randomUUID()}`))) return
  try {
    await removeLock(lockFile, holder)
  } finally {
    await rm(guard, { force: true })
  }
}

// Only removes the lock while it still names `owner`, so a process never deletes a lock another one has since taken.
async function removeLock(lockFile: string, owner: string): Promise<void> {
  const current = await readFile(lockFile, 'utf-8').catch(() => null)
  if (current === owner) await rm(lockFile, { force: true })
}

function isDeadOwner(owner: string): boolean {
  // A lock just created is empty until its owner is written.
  const pid = /^(\d+):[\w-]+$/.exec(owner)?.[1]
  if (pid === undefined) return false
  try {
    process.kill(Number(pid), 0)
    return false
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'EPERM'
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
  // A sign-in must not be overwritten by a refresh of the previous login running in another process.
  return await withAuthLock(() => writeTokens(tokenResponse))
}

async function writeTokens(tokenResponse: TokenResponse): Promise<SavedTokens> {
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
  const tempFile = `${authFile}.${randomUUID()}.tmp`
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
