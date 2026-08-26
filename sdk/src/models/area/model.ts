import type { TeamId, UserId } from '../user'
import type { AuditProps } from '../shared'
import type { LatLng } from '../location'
import type { CustomFieldFilter } from '../customFields/model'
import type { CustomFieldId, CustomFieldType } from '../customFields'
import type { AccountStatusId, WorkflowStageId } from '../account'

export type AreaId = `Area.${string}`
export type AreaAssignmentType = 'user' | 'team' | 'company' | 'draft'
export type AreaStateName = 'draft' | 'scheduled' | 'assigned' | 'expiring' | 'unassigned'
export type AreaRunType = 'assign' | 'unassign' | 'reassign'

export type AreaFilters = {
  cities?: string[]
  states?: string[]
  zipCodes?: string[]
  statusIds?: AccountStatusId[]
  workflowStageIds?: WorkflowStageId[]
  teamIds?: TeamId[]
  userIds?: UserId[]
  customFields?: {
    id: CustomFieldId
    value: CustomFieldType
  }[]
  advancedCustomFields?: CustomFieldFilter
}

export type AreaAssignmentConfig =
  | {
      enabled: false
      autoRunOnImport?: boolean
    }
  | {
      enabled: true
      autoRunOnImport?: boolean
      order: number
    }

export type AreaScheduleEntry =
  | {
      type: 'assign' | 'unassign'
      at: number
    }
  | {
      type: 'reassign'
      at: number
      teamId?: TeamId
      userIds?: UserId[]
    }

export type AreaRunHistoryEntry = {
  timestamp: number
  count: number
  type?: AreaRunType
  runBy?: UserId
  process?: string
  teamId?: TeamId
  userIds?: UserId[]
}

export type AreaJobInfo = {
  total: number
  assigned: number
  assignedDate: number
  isRunning: boolean
  status: 'preparing' | 'queued' | 'running' | 'completed'
}

export type UnsavedArea = {
  name?: string
  coordinates: LatLng[]
  assignmentType: AreaAssignmentType
  teamId?: TeamId
  userIds?: UserId[]
  color?: string
  note?: string
  filters?: AreaFilters
  assignmentConfig?: AreaAssignmentConfig
  schedule?: AreaScheduleEntry[]
}

export type AreaData = UnsavedArea &
  AuditProps & {
    areaId: AreaId
    importId?: string
    deleteOnCompletion?: boolean
    runHistory?: AreaRunHistoryEntry[]
    jobInfo?: AreaJobInfo
  }
