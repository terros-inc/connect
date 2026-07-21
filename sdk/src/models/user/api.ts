import type { CompanyData, CompanyId } from '../company'
import type {
  CloserStatus,
  EntityId,
  RoleId,
  SmallCloser,
  SmallUser,
  TeamId,
  TinyUser,
  UnsavedUser,
  UserData,
  UserId,
  UserIdentifier,
  UserProfileData,
} from './model'
import type { ApiSuccess } from '@terros-inc/connect-common'

export type UserListInput = {
  showArchived?: true | false | 'all'
  companyId?: CompanyId
  teamId?: TeamId
  userIds?: UserId[]
  showBeta?: boolean
}
export type UserListSuccess = ApiSuccess<{
  users: SmallUser[]
}>

export type UserAddInput = {
  user: UnsavedUser & { userId?: UserId }
  teamMemberships?: {
    teamId: TeamId
    roleIds?: RoleId[]
  }[]
  directRoles?: RoleId[]
}
export type UserAddSuccess = ApiSuccess<{
  user: UserProfileData
  password?: string
}>

export type UserUpdateInput = {
  user: Partial<UserProfileData>
}
export type UserUpdateSuccess = ApiSuccess<{
  user: UserProfileData
}>

export type UserBulkUpdateInput = {
  entityIds: EntityId[]
  operation: { type: 'invalidateCloserSettings' }
}
export type UserBulkUpdateSuccess = ApiSuccess<{
  updatedCount: number
}>

export type UserRemoveInput =
  | {
      archive?: boolean
      userId: UserIdentifier
    }
  | {
      archive?: boolean
      userIds: UserId[]
    }

export type UserGetInput = {
  /** User ID, email, or clientUserId. Defaults to the current user if not provided. */
  userId?: UserIdentifier
}
export type UserGetSuccess = ApiSuccess<{
  user: UserData
}>

export type UserProfileInput = {
  userId?: string
}
export type UserProfileSuccess = ApiSuccess<{
  user: UserProfileData
  company: CompanyData
}>

export type UserSearchInput = {
  archived?: true | false | 'all'
  companyId?: CompanyId
  query: string
  teamIds?: TeamId[]
  closerStatus?: CloserStatus[]
  options?: {
    /** Show the first 20 users from your downline. */
    downline?: boolean
    size?: number
  }
}
export type UserSearchSuccess = ApiSuccess<{
  users: TinyUser[]
}>

export type UserTimezoneInput = {
  timeZone: string
}

export type UserReportInput = {
  userId?: UserId
}
export type UserReportSuccess = ApiSuccess<{
  manager?: TinyUser
  managers: TinyUser[]
  members: TinyUser[]
  directReports: TinyUser[]
}>

export type UserClosersInput = {
  /**
   * CompanyId: all closers in the company.
   * TeamId: all closers from the highest relevant parent team and its downline.
   * TeamId + direct: all closers directly on the team.
   * UserId: the target user's closer settings.
   * Omitted: all closers from the user's teams, their highest relevant parent team, and its downline.
   */
  entityId?: EntityId
  direct?: boolean
}
export type UserClosersSuccess = ApiSuccess<{
  closers: SmallCloser[]
}>

export type UserManagerInput = {
  userId?: UserId
}
export type UserManagerSuccess = ApiSuccess<{
  possibleManagers: TinyUser[]
  primaryManager?: TinyUser
}>
