import { cwd } from 'node:process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { CONNECT_PERMISSION_TYPES } from './permissionTypes'
import { CONFIG_FILE_NAME } from './constants'

export const ScriptType = z.enum(['incoming', 'outgoing', 'scheduled'])

export const ScriptDataType = z.enum(['Account', 'Company', 'User', 'Event', 'Screenshot'])

export const ConfigMappingDataType = z.enum(['None', 'Account', 'User', 'Event'])

export const ConfigFieldType = z.enum(['string', 'number', 'mapping'])

const ConfigSchemaFieldBase = z.object({
  name: z.string(),
  description: z.string().optional(),
  dataType: ConfigMappingDataType.optional(),
})

const CustomFieldAccess = z.enum(['read', 'write'])

export const ConfigSchemaField = z.discriminatedUnion('type', [
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['string']),
    customFieldAccess: CustomFieldAccess.optional(),
  }),
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['number']),
    customFieldAccess: z.never().optional(),
  }),
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['mapping']),
    customFieldAccess: z.never().optional(),
  }),
])

export const ConfigSchema = z.array(ConfigSchemaField)

export const ScriptAuth = z.record(
  z.string(),
  z.union([
    z.string(),
    z.object({
      description: z.string(),
      mapping: z.boolean().optional(),
    }),
  ])
)

export const UnsavedScriptBase = z.object({
  name: z.string(),
  description: z.string().max(10_000).optional().meta({
    description: 'Instructions on how to configure the script',
  }),
  entrypoint: z.string(),
  configSchema: ConfigSchema,
  authSchema: ScriptAuth,
  permissions: z.array(z.enum(CONNECT_PERMISSION_TYPES)),
  slug: z.string().optional().meta({
    description: 'Stable public key used in incoming webhook URLs. Generated on create when omitted.',
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
