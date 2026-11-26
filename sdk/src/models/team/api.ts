import type { ApiSuccess } from '@terros-inc/connect-common'
import type { CompanyId } from '../company'
import type { TeamId, TinyUser } from '../user'
import type { PartialTeamData, TeamData, TeamMemberData, TinyTeam, UnsavedTeam } from './model'

export type TeamListInput = {
  showArchived?: true | false | 'all'
  companyId?: CompanyId
}

export type TeamListSuccess = ApiSuccess<{
  teams: TeamData[]
}>

export type TeamGetInput = {
  teamId: TeamId
}

export type TeamGetSuccess = ApiSuccess<{
  team: TeamData
  childTeams: TinyTeam[]
  members: TeamMemberData[]
}>

export type TeamAddInput = UnsavedTeam

export type TeamAddSuccess = ApiSuccess<{
  team: TeamData
}>

export type TeamUpdateData = Omit<PartialTeamData, 'parentId'> & {
  parentId?: TeamId | null
}

export type TeamUpdateInput = {
  team: TeamUpdateData
}

export type TeamUpdateSuccess = ApiSuccess<{
  team: TeamData
  childTeams: TinyTeam[]
  members: TeamMemberData[]
}>

export type TeamRemoveInput = {
  teamId: TeamId
  archive?: boolean
}

export type TeamRemoveSuccess = ApiSuccess

export type TeamDownlineInput = {
  entityId: TeamId | CompanyId
  archived?: true | false | 'all'
}

export type TeamDownlineSuccess = ApiSuccess<{
  users: TinyUser[]
}>
