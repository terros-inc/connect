import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { CONFIG_FILE_NAME } from '../connect/constants'

type ConfigFile = { $schema?: unknown; appId?: unknown; [key: string]: unknown }

export type SaveAppIdResult = 'saved' | 'missing' | { existingAppId: string }

function configPath(dir: string): string {
  return join(dir, CONFIG_FILE_NAME)
}

async function readConfigFile(dir: string): Promise<ConfigFile | undefined> {
  if (!existsSync(configPath(dir))) return undefined
  return JSON.parse(await readFile(configPath(dir), 'utf8')) as ConfigFile
}

/** The `appId` in `terros.json` in `dir`, if the file sets one. */
export async function readConfigAppId(dir: string): Promise<string | undefined> {
  const appId = (await readConfigFile(dir))?.appId
  return typeof appId === 'string' && appId !== '' ? appId : undefined
}

/** Write `appId` into `terros.json` in `dir`, never replacing a different app's ID. */
export async function saveConfigAppId(dir: string, appId: string): Promise<SaveAppIdResult> {
  const config = await readConfigFile(dir)
  if (!config) return 'missing'
  const existingAppId = await readConfigAppId(dir)
  if (existingAppId !== undefined && existingAppId !== appId) return { existingAppId }
  const { $schema, appId: _appId, ...rest } = config
  const updated = $schema === undefined ? { appId, ...rest } : { $schema, appId, ...rest }
  await writeFile(configPath(dir), `${JSON.stringify(updated, null, 2)}\n`)
  return 'saved'
}
