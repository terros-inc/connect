import type { AppVersionData, UnsavedAppVersion } from './model'
import type { ApiSuccess } from '@terros-inc/connect-common'

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
