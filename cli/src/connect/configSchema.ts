import { cwd } from 'node:process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { CONNECT_PERMISSION_TYPES } from './permissionTypes.ts'
import { CONFIG_FILE_NAME } from './constants.ts'

export const ScriptType = z.enum(['incoming', 'outgoing', 'scheduled'])

export const ScriptDataType = z.enum(['Account', 'Company', 'User', 'Event', 'Screenshot'])

export const ConfigMappingDataType = z.enum(['None', 'Account', 'User', 'Event'])

export const ConfigFieldType = z.enum([
  'string',
  'number',
  'mapping',
  'boolean',
  'select',
  'team',
  'workflow-stage',
  'user',
])

const ConfigSchemaFieldBase = z.object({
  name: z.string(),
  description: z.string().optional(),
  dataType: ConfigMappingDataType.optional(),
})

const CustomFieldAccess = z.enum(['read', 'write'])
const SELECT_OPTION_NOT_BLANK = 'Select options cannot be blank or whitespace-only'
const SELECT_OPTIONS_UNIQUE = 'Select options must be unique'

const SelectOptions = z
  .array(z.string().regex(/\S/, { error: SELECT_OPTION_NOT_BLANK }))
  .min(1)
  .refine((options) => new Set(options).size === options.length, { error: SELECT_OPTIONS_UNIQUE })
  .meta({ uniqueItems: true })

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
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['boolean']),
    customFieldAccess: z.never().optional(),
  }),
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['select']),
    options: SelectOptions,
    customFieldAccess: z.never().optional(),
  }),
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['team']),
    customFieldAccess: z.never().optional(),
  }),
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['workflow-stage']),
    customFieldAccess: z.never().optional(),
  }),
  ConfigSchemaFieldBase.extend({
    type: ConfigFieldType.extract(['user']),
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

export const AppRepository = z.object({
  url: z
    .string()
    .regex(/^https:\/\//)
    .url(),
  directory: z.string().min(1).optional(),
})
export type AppRepository = z.infer<typeof AppRepository>

export const ConnectConfig = z.object({
  appId: z.string(),
  repository: AppRepository.optional(),
  scripts: z.array(UnsavedScript),
})
export type ConnectConfig = z.infer<typeof ConnectConfig>

export async function readConnectConfig(): Promise<ConnectConfig> {
  const file = join(cwd(), CONFIG_FILE_NAME)
  const contents = await readFile(file, { encoding: 'utf-8' })
  return ConnectConfig.parse(JSON.parse(contents))
}
