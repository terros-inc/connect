import type { ApiSuccess } from '@terros-inc/connect-common'
import type { AppVersionData } from '../version'
import type { AppData, AppId } from './model'

export type AppGetInput = {
  appId: AppId
}
export type AppGetSuccess = ApiSuccess<{
  app: AppData
  versions: AppVersionData[]
}>
