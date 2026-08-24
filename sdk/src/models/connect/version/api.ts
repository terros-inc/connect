import type { ApiSuccess } from '@terros-inc/connect-common'
import type { AppId } from '../app'
import type { ScriptData } from '../script'
import type { AppVersionData, UnsavedAppVersion } from './model'

export type VersionGetInput = {
  appId: AppId
  appVersion: string
}
export type VersionGetSuccess = ApiSuccess<{
  appVersion: AppVersionData
  scripts: ScriptData[]
}>

export type VersionAddInput = {
  versionData: UnsavedAppVersion
}
export type VersionAddSuccess = ApiSuccess<{
  appVersion: AppVersionData
}>

export type VersionUpdateInput = {
  appVersion: AppVersionData
}
export type VersionUpdateSuccess = ApiSuccess<{
  appVersion: AppVersionData
}>
