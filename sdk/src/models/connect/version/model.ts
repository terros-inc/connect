import type { AppId } from '../app'

export type AppVersionId = `AppVersion.${string}`

export type UnsavedAppVersion = {
  appId: AppId
  appVersion: string
  status: 'draft' | 'deployed' | 'deprecated'
  changelog?: string
  permissions?: string[]
  cache?: {enabled: boolean; ttlSeconds: number}
  deployedAt?: number
}

export type AppVersionData = UnsavedAppVersion & {
  versionId: AppVersionId
}