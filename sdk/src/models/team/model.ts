import type { TeamId } from '../user'

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
  meetingTimes?: { day: number; start: number; end: number }[]
}
