import { join } from 'node:path'
import { homedir } from 'node:os'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const CACHE_TTL = 24 * 60 * 60 * 1000
type CacheName = 'profile' | 'openapi'

function cacheDirectory(): string {
  return join(homedir(), '.config', 'terros')
}

export async function readCache(name: CacheName, key: string): Promise<unknown> {
  try {
    const cache = JSON.parse(await readFile(join(cacheDirectory(), `${name}.json`), 'utf8'))
    const age = Date.now() - cache.updatedAt
    if (cache.key === key && Number.isFinite(age) && age >= 0 && age < CACHE_TTL) return cache.data
  } catch {
    // Missing or corrupt caches are refreshed on demand.
  }
  return undefined
}

export async function writeCache(name: CacheName, key: string, data: unknown): Promise<void> {
  const directory = cacheDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const path = join(directory, `${name}.json`)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ key, updatedAt: Date.now(), data }), { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function clearRuntimeCaches(): Promise<void> {
  await Promise.all(['profile', 'openapi'].map((name) => rm(join(cacheDirectory(), `${name}.json`), { force: true })))
}
