import type { ApiSuccess } from '../../shared'
import type { AppVersionData, UnsavedAppVersion } from './model'

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
