import { cwd } from 'node:process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { CONFIG_FILE_NAME } from './constants'

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

const TiptapText = z.object({
  type: z.literal('text'),
  text: z.string(),
  marks: z
    .array(
      z.union([
        z.object({ type: z.enum(['bold', 'underline', 'strike']) }),
        z.object({
          type: z.literal('link'),
          attrs: z.object({
            href: z.string(),
            rel: z.string(),
            target: z.string().nullable(),
            class: z.string().nullable(),
          }),
        }),
      ])
    )
    .optional(),
})

const TiptapParagraph = z
  .object({ type: z.literal('paragraph'), content: z.array(TiptapText) })
  .meta({ id: 'TiptapParagraph' })

const TiptapHeading = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.int().min(1).max(6) }),
  content: z.array(TiptapText),
})

const TiptapListItem = z
  .object({
    type: z.literal('listItem'),
    get content() {
      return z.array(z.union([TiptapBulletList, TiptapOrderedList, TiptapParagraph]))
    },
  })
  .meta({ id: 'TiptapListItem' })

const TiptapBulletList = z
  .object({ type: z.literal('bulletList'), content: z.array(TiptapListItem) })
  .meta({ id: 'TiptapBulletList' })

const TiptapOrderedList = z
  .object({
    type: z.literal('orderedList'),
    attrs: z.object({ start: z.int().min(1), type: z.null() }),
    content: z.array(TiptapListItem),
  })
  .meta({ id: 'TiptapOrderedList' })

export const TiptapDoc = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.union([TiptapParagraph, TiptapHeading, TiptapBulletList, TiptapOrderedList])),
  })
  .meta({ id: 'TiptapDoc', description: 'Tiptap rich-text document, the shape the Terros API stores' })
export type TiptapDoc = z.infer<typeof TiptapDoc>

export const UnsavedScriptBase = z.object({
  name: z.string(),
  description: z.union([z.string(), TiptapDoc]).optional().meta({
    description:
      'Instructions on how to configure the script: plain text, with a blank line between paragraphs, or a Tiptap rich-text document',
  }),
  entrypoint: z.string(),
  configSchema: ConfigSchema,
  authSchema: ScriptAuth,
  permissions: z.array(z.string()),
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
  $schema: z.string().optional(),
  appId: z.string(),
  scripts: z.array(UnsavedScript),
})
export type ConnectConfig = z.infer<typeof ConnectConfig>

export async function readConnectConfig(): Promise<ConnectConfig> {
  const file = join(cwd(), CONFIG_FILE_NAME)
  const contents = await readFile(file, { encoding: 'utf-8' })
  return ConnectConfig.parse(JSON.parse(contents))
}
