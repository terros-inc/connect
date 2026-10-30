import type { AppId } from '../app'

export type ConfigSchemaField = {
  name: string
  type: 'string' | 'number' | 'mapping'
  description?: string
  dataType?: 'None' | 'Account' | 'User' | 'Event'
}

export type AuthSchemaField =
  | string
  | {
      description: string
      mapping?: boolean
    }

export type TiptapMark =
  | { type: 'bold' | 'underline' | 'strike' }
  | { type: 'link'; attrs: { href: string; rel: string; target: string | null; class: string | null } }

export type TiptapText = {
  type: 'text'
  text: string
  marks?: TiptapMark[]
}

export type TiptapParagraph = {
  type: 'paragraph'
  content: TiptapText[]
}

export type TiptapHeading = {
  type: 'heading'
  attrs: { level: number }
  content: TiptapText[]
}

export type TiptapListItem = {
  type: 'listItem'
  content: (TiptapBulletList | TiptapOrderedList | TiptapParagraph)[]
}

export type TiptapBulletList = {
  type: 'bulletList'
  content: TiptapListItem[]
}

export type TiptapOrderedList = {
  type: 'orderedList'
  attrs: { start: number; type: null }
  content: TiptapListItem[]
}

/** Rich-text document, as written by the Tiptap editor in Terros. */
export type TiptapDoc = {
  type: 'doc'
  content: (TiptapParagraph | TiptapHeading | TiptapBulletList | TiptapOrderedList)[]
}

export type ScriptBase = {
  appId: AppId
  appVersion: string
  name: string
  description?: TiptapDoc
  configSchema: ConfigSchemaField[]
  authSchema: Record<string, AuthSchemaField>
  scriptStorage?: 'inline' | 'blob'
  permissions: string[]
  slug?: string
}

export type IncomingScript = ScriptBase & {
  type: 'incoming'
}

export type OutgoingScript = ScriptBase & {
  type: 'outgoing'
  dataType: 'Account' | 'Company' | 'User' | 'Event'
}

export type ScheduledScript = ScriptBase & {
  type: 'scheduled'
  cron: string
}

export type UnsavedScript = IncomingScript | OutgoingScript | ScheduledScript

export type ScriptData = UnsavedScript & {
  scriptId: string
}
