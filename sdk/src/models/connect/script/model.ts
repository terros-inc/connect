import type { AppId } from '../app'

export type ConfigSchemaField = {
  name: string
  type: 'string' | 'number' | 'mapping'
  description?: string
  dataType?: 'None' | 'Account' | 'User' | 'Event'
}

export type ScriptBase = {
  appId: AppId
  appVersion: string
  name: string
  description?: string
  configSchema: ConfigSchemaField[]
  authSchema: Record<string, string>
  scriptStorage?: 'inline' | 'blob'
  mainScript?: string
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
