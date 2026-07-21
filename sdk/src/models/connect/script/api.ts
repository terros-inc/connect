import type { ApiSuccess } from '../../shared'
import type { ScriptData, UnsavedScript } from './model'

export type ScriptAddInput = {
  script: UnsavedScript
  scriptSize?: number
}
export type ScriptAddSuccess = ApiSuccess<{
  script: ScriptData
  uploadUrl?: string
}>
