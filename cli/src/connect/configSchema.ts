import { cwd } from 'node:process'
import { join } from 'node:path'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { CONFIG_FILE_NAME } from './constants'

export const ApiPermission = z
    .string()
    .regex(/^[a-z]+\/[a-z/]+$/, 'Must be a valid API path like "user/add" or "calendar/event/update"')
    .describe('Terros API endpoint permission')

export const ScriptType = z.enum(['incoming', 'outgoing', 'scheduled'])

export const ScriptDataType = z.enum(['Account', 'Company', 'User', 'Event'])

export const ConfigMappingDataType = z.enum(['None', 'Account', 'User', 'Event'])

export const ConfigFieldType = z.enum(['string', 'number', 'mapping'])

export const ConfigSchemaField = z.object({
  name: z.string(),
  type: ConfigFieldType,
  description: z.string().optional(),
  dataType: ConfigMappingDataType.optional(),
})

export const ConfigSchema = z.array(ConfigSchemaField)

export const ScriptAuth = z.record(z.string(), z.string())

export const UnsavedScriptBase = z.object({
  name: z.string(),
  entrypoint: z.string(),
  configSchema: ConfigSchema,
  authSchema: ScriptAuth,
  permissions: z.array(ApiPermission),
  slug: z.string().optional().meta({
    description: 'Stable public key used in incoming webhook URLs.',
  }),
})

export const UnsavedIncomingScript = z.object({
  ...UnsavedScriptBase.shape,
  type: ScriptType.extract(['incoming']),
})

export const UnsavedOutgoingScript = z.object({
  ...UnsavedScriptBase.shape,
  type: ScriptType.extract(['outgoing']),
  dataType: ScriptDataType,
})

export const UnsavedScheduledScript = z.object({
  ...UnsavedScriptBase.shape,
  type: ScriptType.extract(['scheduled']),
  cron: z.string(),
})

export const UnsavedScript = z.discriminatedUnion('type', [
  UnsavedIncomingScript,
  UnsavedOutgoingScript,
  UnsavedScheduledScript,
])
export type UnsavedScript = z.infer<typeof UnsavedScript>

export const ConnectConfig = z.object({
  appId: z.string(),
  scripts: z.array(UnsavedScript),
})
export type ConnectConfig = z.infer<typeof ConnectConfig>

export async function readConnectConfig(): Promise<ConnectConfig> {
  const file = join(cwd(), CONFIG_FILE_NAME)
  const contents = await readFile(file, { encoding: 'utf-8' })
  return ConnectConfig.parse(JSON.parse(contents))
}
