import type { TinyTeam } from '../team'
import type { AuditProps, CustomFieldMap } from '../shared'
import type { Address } from '../location'
import type { CompanyId } from '../company'

export type UserId = `U:${string}` | `U.${string}`
export type TeamId = `Team:${string}` | `Team.${string}`
export type RoleId = `Role.${string}`

/** A user ID, email, or clientUserId. */
export type UserIdentifier = string

export type CloserStatus = 'None' | 'Needs_Help' | 'Can_Close' | 'Can_Help' | 'Closer_Only'

export type TinyRole = {
  roleId: RoleId
  roleType: 'admin' | 'manager' | 'recruit' | null
  name: string
}

export type TinyUser = {
  userId: UserId
  clientUserId?: string
  firstName: string
  lastName: string
  preferredName?: string
  avatarBlurhash?: string
  avatarUrl?: string
  lastAccess?: number
  isDeleted?: boolean
  color?: string
}

export type SmallUser = TinyUser & {
  email: string
  phone?: string
  title?: string
  timeZone?: string
  teamIds?: TeamId[]
  closerStatus?: CloserStatus
  roles?: TinyRole[]
  memberOf?: Pick<TinyTeam, 'teamId' | 'name'>[]
  companyId?: CompanyId
}

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export type CloserSettings = {
  order?: number
  taskLockout?: boolean
  bookingPercent?: number
  meetingDuration?: number
  timeBetweenAppointments?: number
  serviceCenter?: { latitude: number; longitude: number }
  serviceRadius?: number
  minimumNotice?: number
  maximumNotice?: number
  timeslots?: Partial<Record<Weekday, number[]>>
  excludes?: number[]
  includes?: number[]
  lastUpdatedDate?: number
}

export type TinyCloser = {
  user: TinyUser
  times: { startTime: number; duration: number }[]
}

export type SmallCloser = TinyUser & CloserSettings & { timezone: string }

export type AvailableCloser = TinyUser & {
  inServiceArea?: boolean
  available: boolean
  locked?: boolean
  unavailableReason?: string
}

type UserScope =
  | { entity: 'self' | 'company' | 'withinRestrictions' | 'none' }
  | { entity: 'downline'; entityId: UserId | TeamId }

type PermissionEntityId = EntityId | RoleId

type ScopeWithSource = UserScope & AuditProps & { source: PermissionEntityId }

type PermissionType = string

/** A reduced view of a user's permission overrides, keyed by permission type. */
export type PermissionMap = Partial<Record<PermissionType, ScopeWithSource[]>>

export type NotificationPreference = {
  push?: boolean
  email?: boolean
}

export type UserPreferences = Partial<Record<string, NotificationPreference>>

export type UnsavedUser = {
  isDeleted?: boolean
  importId?: string
  phone?: string
  firstName: string
  lastName: string
  preferredName?: string
  email: string
  timeZone?: string
  clientUserId?: string
  title?: string
  closerStatus?: CloserStatus
  companyId?: CompanyId
  managerId?: UserId
  hasManager?: boolean
  selfReportedManager?: {
    managerId?: UserId
    updatedAt: number
  }
  primaryTeam?: {
    teamId: TeamId
    staleAfter: number
  }
  betaProgram?: boolean
  language?: string
  secondaryLanguages?: string[]
  color?: string
  superuserScore?: number
  customFields?: CustomFieldMap
  accountId?: string
  whitelist?: boolean
  closer?: CloserSettings
}

export type UserTeamsByLevel = {
  team1?: TinyTeam[]
  team2?: TinyTeam[]
  team3?: TinyTeam[]
  team4?: TinyTeam[]
  team5?: TinyTeam[]
  team6?: TinyTeam[]
  team7?: TinyTeam[]
  team8?: TinyTeam[]
  groups: TinyTeam[]
}

export type UserTeamData = UserTeamsByLevel & {
  manages: TeamId[]
  directMemberOf: TinyTeam[]
  memberOf: TinyTeam[]
  managers: TinyUser[]
  manager?: TinyUser
}

export type UserData = UnsavedUser & {
  lastAccess?: number
  avatarBlurhash?: string
  avatarUrl?: string
  userId: UserId
  companyId: CompanyId
  firstAccess?: number
  startDate?: number
  clientTeamId?: string
  teams?: UserTeamData
  roles?: TinyRole[]
  biography?: string
  notificationPrefs?: UserPreferences
  agreeToTerms?: number
  agreeToLicensing?: number
  agreeToAITraining?: boolean
}

export type UserProfileData = UserData & {
  createdAt?: number
  createdBy?: UserId
  updatedAt?: number
  updatedBy?: UserId
  permissionMap?: PermissionMap
  mailingAddress?: Address
  shoeSize?: string
  shirtSize?: string
  birth?: {
    month?: number
    day?: number
  }
  uploadAvatarUrl?: string
  closerIds?: UserId[]
  directRoles?: TinyRole[]
}

/** Every entity type that can own users/teams in bulk operations. */
export type EntityId = UserId | TeamId | CompanyId
