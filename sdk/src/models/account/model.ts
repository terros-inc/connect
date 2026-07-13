import type { RoleId, SmallUser, TeamId, UserId } from '../user'
import type { CustomFieldMap } from '../shared'
import type { LatLng, SmallAddress } from '../location'

export type AccountId = `Account:${string}` | `Account.${string}`
export type AccountStatusId = `AS.${string}`
export type WorkflowId = `WF.${string}`
export type WorkflowStageId = `S.${string}`
export type WorkflowActionId = `A.${string}`
export type ContactId = `Contact:${string}` | `Contact.${string}`
export type NoteId = `Note.${string}`
export type TagId = `Tag.${string}`
export type LocationId =
  | `Can.${string}`
  | `LocNew:${string}`
  | `LocNew.${string}`
  | `Loc:${string}`
  | `TLoc:${string}`
  | `TLoc.${string}`
  | `FA.${string}`
  | `PR.${string}`
export type DispositionId =
  | `Disposition:${string}`
  | `Disposition.${string}`
  | 'NotHome'
  | 'Comeback'
  | 'NotNow'
  | 'NotQualified'
  | 'PartialPitch'
  | 'NewAccount'
  | 'Competitor'
  | 'Custom1'
  | 'Custom2'
  | 'Custom3'

type ContactMethod = 'door' | 'phone'

export type RangeFilter = {
  gte?: number
  lte?: number
}

/** A cursor for paging through sorted account lists. */
export type SortCursor = number | number[]

export type AccountUserDetails = Omit<SmallUser, 'userId' | 'memberOf'>

export type StatusHistoryItem = {
  statusId: AccountStatusId
  sourceStatus?: string
  statusChangedDate: number
}

export type WorkflowHistoryItem = {
  stageId: WorkflowStageId
  actionId?: WorkflowActionId
  userId: UserId
  timestamp: number
  latlng?: LatLng
  sourceStatus?: string
}

export type UserHistory = {
  userId: UserId
  timestamp: number
}[]

export type UnsavedAccountContact = {
  timestamp: number
  method: ContactMethod
  userId: UserId
  contactId?: ContactId
  dispositionId: DispositionId
  deviceLocation?: LatLng
  isPitch?: boolean
}

export type AccountContact = UnsavedAccountContact & {
  contactId: ContactId
}

export type UnsavedAccountNote = {
  timestamp: number
  text: string
  userId: UserId
  noteId?: NoteId
}

export type AccountNote = UnsavedAccountNote & {
  noteId: NoteId
}

type TagWithDate = {
  tagId: TagId
  timestamp: number
  userId: UserId
}

/** Not modeled in detail by this SDK — treat as an opaque record. */
export type TinyResidentData = Record<string, unknown>

export type UnsavedAccount = {
  customFields?: CustomFieldMap
  importId?: string
  workflowId?: WorkflowId
  workflowHistory?: WorkflowHistoryItem[]
  workflowStageId?: WorkflowStageId
  workflowActionId?: WorkflowActionId
  deviceLocation?: LatLng
  checkpoints?: WorkflowStageId[]
  accountId?: AccountId
  /** @deprecated use workflowStageId/workflowActionId */
  statusId?: AccountStatusId
  accountSource?: string
  sourceStatus?: string
  sourceId?: string
  externalLeadId?: string
  locationId?: LocationId
  location?: SmallAddress
  ownerId?: UserId
  owner?: AccountUserDetails
  closerId?: UserId
  closer?: AccountUserDetails
  resident?: TinyResidentData
  resident2?: TinyResidentData
  language?: string
  /** @deprecated */
  rescheduleCount?: number
  /** @deprecated */
  dealSize?: number
  appointmentDate?: number
  test?: boolean
  teamId?: TeamId
  contacts?: UnsavedAccountContact[]
  notes?: UnsavedAccountNote[]
  isParent?: boolean
  parentAccountId?: AccountId
  tags?: TagWithDate[]
}

export type TinyWorkflowAccount = {
  accountId: AccountId
  workflowId: WorkflowId
  workflowStageId: WorkflowStageId
  workflowActionId?: WorkflowActionId
  workflowLastActionDate?: number
  workflowHistory: WorkflowHistoryItem[]
  customFields?: CustomFieldMap
}

export type AccountData = Omit<UnsavedAccount, 'contacts' | 'notes'> & {
  accountId: AccountId
  createdAt?: number
  createdBy?: UserId
  updatedAt?: number
  updatedBy?: UserId
  statusHistory: StatusHistoryItem[]
  workflowStageName?: string
  workflowActionName?: string
  homeowner?: TinyResidentData
  userMissDate?: number
  locationMissDate?: number
  expiresAt?: number
  contacts?: AccountContact[]
  notes?: AccountNote[]
  lastActionDate?: number
  recruitId?: UserId
  ownerHistory?: UserHistory
  closerHistory?: UserHistory
  editable?: boolean
}

export type AccountSortBy = 'createdDate' | 'lastActionDate' | 'lastUpdatedDate' | `CF.${string}`
export type AccountSortOrder = 'asc' | 'desc'

/** Not modeled in detail by this SDK — treat as an opaque record. */
export type CustomFieldFilter = Record<string, unknown>

export type AccountDataResponse = {
  accounts: AccountData[]
  sortTimestamp?: SortCursor
  total?: number
}

export type BulkModifyAccountsAction = (
  | {
      actionType: 'updateStatus'
      statusId: AccountStatusId
    }
  | {
      actionType: 'updateStage'
      stageId: WorkflowStageId
    }
  | {
      actionType: 'delete' | 'clearDisposition'
    }
)[]

/** Not modeled in detail by this SDK — treat as an opaque record. */
export type ElasticFilter = {
  cities?: string[]
  states?: string[]
  zipCodes?: string[]
  advancedCustomFields?: CustomFieldFilter
  statusIds?: AccountStatusId[]
  workflowStageIds?: WorkflowStageId[]
  tagIds?: TagId[]
  teamIds?: TeamId[]
  userIds?: UserId[]
  coordinates?: LatLng[]
  boundingBox?: {
    top: LatLng
    bottom: LatLng
  }
  workflowActionCount?: RangeFilter
  contactCount?: RangeFilter
}

export type PartialAddress = Partial<Omit<SmallAddress, 'latlng'>> & {
  latlng?: Partial<LatLng>
}

export type UpsertLatLng = {
  latitude?: string | number
  longitude?: string | number
}

export type UpsertTinyResidentData = Record<string, unknown>

export type AccountStatusCode =
  | 'Lead'
  | 'Set'
  | 'Sit'
  | 'Closed'
  | 'Approved'
  | 'Permit Submitted'
  | 'Permit Approved'
  | 'Installed'
  | 'Archived'
  | 'Do Not Contact'

type SetterCloserConfig = {
  includeOnPlan?: boolean
  allowPayment?: boolean
}

/** The account/list entity scope this status applies to. */
type AccountStatusScope = string

export type UnsavedAccountStatus = {
  name: string
  /** @deprecated */
  order?: number
  short?: string
  plural?: string
  description?: string
  legacyCode?: AccountStatusCode
  color?: string
  icon?: string
  restricted?: boolean
  roles?: Record<RoleId, SetterCloserConfig>
  integrationMapping?: string[]
  scope: AccountStatusScope
  setter?: SetterCloserConfig
  closer?: SetterCloserConfig
  selfgen?: SetterCloserConfig
  isFinalState?: boolean
  createUser?: boolean
  columnVisibility?: TeamId[]
  requiredFields?: string[]
  isArchivedState?: boolean
}

export type AccountStatusData = UnsavedAccountStatus & {
  statusId: AccountStatusId
  isDeleted?: boolean
  createdAt?: number
  createdBy?: UserId
  updatedAt?: number
  updatedBy?: UserId
}

export type TinyAccountStatus = Pick<AccountStatusData, 'name' | 'statusId'>
