import type { CustomFieldMap } from '../customFields'
import type { LatLng } from '../location'
import type { AuditProps } from '../shared'
import type { RoleId, TeamId, UserData } from '../user'

export type MeetingTime = {
  day: number
  start: number
  end: number
}

export type UnsavedTeam = {
  teamId?: TeamId
  name: string
  parentId?: TeamId
  level: number
  externalId?: string
  description?: string
  customFields?: CustomFieldMap
}

export type TeamData = AuditProps &
  UnsavedTeam & {
    teamId: TeamId
    timeZone?: string
    officeLocation?: LatLng
    officeAddress?: string
    meetingTimes?: MeetingTime[]
    isCloserBoundary?: boolean
    restrictVisibility?: boolean
    avatarBlurhash?: string
    avatarUrl?: string
    parentTeamIds: TeamId[]
    uploadAvatarUrl?: string
    isDeleted?: boolean
  }

export type TinyTeam = {
  teamId: TeamId
  name: string
  parentId?: TeamId
  isDeleted?: boolean
  externalId?: string
  avatarBlurhash?: string
  avatarUrl?: string
  restrictVisibility?: boolean
  level: number
  meetingTimes?: MeetingTime[]
}

export type PartialTeamData = Partial<TeamData> & {
  teamId: TeamId
}

export type TeamMemberData = AuditProps & {
  user: UserData
  /** @deprecated Use roleIds instead. */
  membership: string
  locked?: boolean
  roleIds?: RoleId[]
  lastInterviewDate?: number
  lastShadowDate?: number
}
