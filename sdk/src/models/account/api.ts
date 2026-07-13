import type { RoleId, SmallUser, TeamId, UserId, UserIdentifier } from '../user'
import type { ApiSuccess, CustomFieldMap } from '../shared'
import type { LatLng } from '../location'
import type { CompanyId } from '../company'
import type {
  AccountData,
  AccountDataResponse,
  AccountId,
  AccountSortBy,
  AccountSortOrder,
  AccountStatusData,
  AccountStatusId,
  BulkModifyAccountsAction,
  ContactId,
  CustomFieldFilter,
  ElasticFilter,
  LocationId,
  NoteId,
  PartialAddress,
  RangeFilter,
  SortCursor,
  StatusHistoryItem,
  TagId,
  UnsavedAccount,
  UnsavedAccountContact,
  UnsavedAccountNote,
  UnsavedAccountStatus,
  UpsertLatLng,
  UpsertTinyResidentData,
  WorkflowActionId,
  WorkflowId,
  WorkflowStageId,
} from './model'

export type AccountStatusSearchInput = {
  accountIds?: AccountId[]
  workflowId?: WorkflowId
  stageIds?: WorkflowStageId[]
  actionIds?: WorkflowActionId[]
  /** @deprecated */
  statusIds?: AccountStatusId[]
  teamId?: TeamId
  userId?: UserId
  roleIds?: RoleId[]
  startTime?: string | number
  endTime?: string | number
  sortTimestamp?: SortCursor
  query?: string
  searchByCurrentStage?: boolean
  tagIds?: TagId[]
  cities?: string[]
  states?: string[]
  zipCodes?: string[]
  customFields?: CustomFieldFilter
  coordinates?: LatLng[]
  contactCount?: RangeFilter
  workflowActionCount?: RangeFilter
  lastActionDate?: RangeFilter
  sortBy?: AccountSortBy
  sortOrder?: AccountSortOrder
}

/** Not modeled in detail by this SDK — treat as an opaque record. */
export type AccountHooksInput = Record<string, unknown>

export type AccountAddInput = {
  account: UnsavedAccount & { hooks?: AccountHooksInput }
}

export type AccountAddSuccess = ApiSuccess<{
  account: AccountData
  duplicate?: boolean
}>

export type AccountPartialUpdateInput = Partial<Omit<AccountData, 'accountId' | 'contacts' | 'notes'>> & {
  actorId?: UserIdentifier
  checkpoints?: WorkflowStageId[]
  hooks?: AccountHooksInput
  contacts?: UnsavedAccountContact[]
  notes?: UnsavedAccountNote[]
  deletedContacts?: ContactId[]
  deletedNotes?: NoteId[]
}

export type AccountUpdateInput = {
  account: AccountPartialUpdateInput & { accountId: AccountId }
}

export type AccountUpdateSuccess = ApiSuccess<{
  account: AccountData
}>

export type AccountUpdateBatchInput = {
  accounts: (AccountPartialUpdateInput & { accountId: AccountId })[]
}

export type AccountUpdateBatchSuccess = ApiSuccess<{
  accounts: AccountData[]
}>

export type AccountListInput = {
  nearby?: LatLng
  searchInput?: AccountStatusSearchInput
  /** 10-1000 */
  size?: number
}

export type AccountListSuccess = ApiSuccess<AccountDataResponse>

export type BulkModifyAccountsInput = {
  filter: ElasticFilter
  actions: BulkModifyAccountsAction
}

export type AccountGetInput = {
  accountId: AccountId
}

export type AccountGetSuccess = ApiSuccess<{
  account: AccountData
  potentialDuplicates?: AccountData[]
}>

type AccountMatchCriterion = 'accountId' | 'externalLeadId' | 'sourceId' | 'address'

export type AccountMatchInput = {
  accountId?: AccountId
  externalLeadId?: string
  sourceId?: string
  location?: PartialAddress
}

export type AccountMatchSuccess = ApiSuccess<{
  account?: AccountData
  matchedOn?: AccountMatchCriterion
  additionalMatches?: AccountData[]
}>

export type AccountRemoveInput = {
  accountId: AccountId
}

type AccountRequestType = 'add' | 'update' | 'upsert'

export type AccountUpsertInput = {
  /** Defaults to 'upsert'. */
  requestType?: AccountRequestType
  account: {
    accountId?: AccountId
    actorId?: UserIdentifier
    /** @deprecated */
    statusId?: AccountStatusId
    /** @deprecated */
    statusHistory?: StatusHistoryItem[]
    workflowId?: WorkflowId
    /** @deprecated use workflowTarget */
    workflowActionOrStageId?: WorkflowActionId | WorkflowStageId
    workflowTarget?: string
    owner?: Partial<SmallUser>
    closer?: Partial<SmallUser>
    location?: Partial<
      PartialAddress & {
        locationId?: LocationId
        latlng?: UpsertLatLng
      }
    >
    resident?: Partial<UpsertTinyResidentData>
    resident2?: Partial<UpsertTinyResidentData>
    accountSource?: string
    sourceStatus?: string
    lastActionDate?: number
    sourceId?: string
    externalLeadId?: string
    test?: boolean
    teamId?: TeamId
    customFields?: CustomFieldMap
    notes?: UnsavedAccountNote[]
  }
  opts?: {
    /** Defaults to true. */
    createCustomLocation?: boolean
  }
}

export type AccountUpsertSuccess = ApiSuccess<{
  account?: AccountData
}>

export type AccountStatusAddInput = {
  status: UnsavedAccountStatus
}

export type AccountStatusAddSuccess = ApiSuccess<{
  status: AccountStatusData
}>

export type AccountStatusUpdateInput = {
  status: AccountStatusData
}

export type AccountStatusUpdateSuccess = ApiSuccess<{
  status: AccountStatusData
}>

export type AccountStatusListInput = {
  archived?: true | false | 'all'
  companyId?: CompanyId
}

export type AccountStatusListSuccess = ApiSuccess<{
  statuses: AccountStatusData[]
  includesDefaults?: boolean
}>

export type AccountStatusRemoveInput = {
  archive?: boolean
  statusId: AccountStatusId
}
