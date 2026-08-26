import type { ApiSuccess } from '@terros-inc/connect-common'
import type { TeamId, UserId } from '../user'
import type { LatLng } from '../location'
import type { AreaData, AreaId, AreaRunType, AreaStateName, UnsavedArea } from './model'

export type AreaSortCursor = string | number | boolean | (string | number | boolean)[]
export type AreaListSortBy = 'order' | 'name' | 'status' | 'lastRunAt' | 'createdAt' | 'updatedAt' | 'areaId'
export type AreaListSortOrder = 'asc' | 'desc'

type OptionalDateRange = {
  startTime?: string | number
  endTime?: string | number
}

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
  query?: string
  boundingBox?: {
    top: LatLng
    bottom: LatLng
  }
  areaStates?: AreaStateName[]
  createdDate?: OptionalDateRange
  lastAssignmentDate?: OptionalDateRange
  expirationDate?: OptionalDateRange
  sortBy?: AreaListSortBy
  sortOrder?: AreaListSortOrder
  sortTimestamp?: AreaSortCursor
  size?: number
}

export type AreaListSuccess = ApiSuccess<{
  areas: AreaData[]
  sortTimestamp?: AreaSortCursor
  total?: number
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
  areas?: AreaData[]
  areaListInput?: AreaListInput
  runType: AreaRunType
}
