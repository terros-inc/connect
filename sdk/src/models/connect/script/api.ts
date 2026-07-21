import type { ScriptData, UnsavedScript } from './model'
import type { ApiSuccess } from '@terros-inc/connect-common'

export type ScriptAddInput = {
  script: UnsavedScript
  scriptSize?: number
}
export type ScriptAddSuccess = ApiSuccess<{
  script: ScriptData
  uploadUrl?: string
}>
