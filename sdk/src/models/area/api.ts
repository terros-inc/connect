import type { ApiSuccess } from '@terros-inc/connect-common'
import type { TeamId, UserId } from '../user'
import type { AreaData, AreaId, AreaRunType, UnsavedArea } from './model'

export type AreaSortCursor = string | number | boolean | (string | number | boolean)[]

export type AreaGetInput = {
  areaId: AreaId
}

export type AreaGetSuccess = ApiSuccess<{
  area: AreaData
}>

export type AreaListInput = {
  userId?: UserId
  teamId?: TeamId
  teamIds?: TeamId[]
  downlineTeamIds?: TeamId[]
  cursor?: AreaSortCursor
  size?: number
}

export type AreaListSuccess = ApiSuccess<{
  areas: AreaData[]
  cursor?: AreaSortCursor
}>

export type AreaAddInput = UnsavedArea

export type AreaAddSuccess = ApiSuccess<{
  area: AreaData
}>

export type AreaUpdateInput = {
  area: AreaData
}

export type AreaUpdateSuccess = AreaAddSuccess

export type AreaRemoveInput = {
  areaId: AreaId
  archive?: boolean
}

export type AreaAssignInput = {
  areas: AreaData[]
  runType: AreaRunType
}
