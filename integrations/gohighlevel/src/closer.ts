import {
  type CalendarEventDataWithDetails,
  type CompanyId,
  type SmallUser,
  type TerrosClient,
  type UserId,
} from '@terros-inc/sdk'
import { normalizeText } from './util.ts'
import { type GoHighLevelUser } from './gohighlevel.ts'

// The closer of a consultation is the Terros event's attendee and the GoHighLevel appointment's assignedUserId. The two
// sides are matched by email. Both directions write only when the sides differ, and when they differ the side changed
// last wins: the Terros event's updatedAt against the GoHighLevel appointment's dateUpdated. Each write makes the sides
// equal, so the echo it causes in the other direction finds nothing to write.

/** The newest write wins. A missing time never lets Terros overwrite GoHighLevel, so an unknown order keeps the GoHighLevel closer. */
export function terrosShouldOverwriteAssignee(
  terrosUpdatedAt: number | undefined,
  goHighLevelUpdatedAt: number | undefined
): boolean {
  if (terrosUpdatedAt === undefined || goHighLevelUpdatedAt === undefined) return false
  return terrosUpdatedAt >= goHighLevelUpdatedAt
}

/** GoHighLevel's change is applied unless Terros is known to be newer (the webhook fires because GoHighLevel changed). */
export function goHighLevelShouldOverwriteAttendee(
  terrosUpdatedAt: number | undefined,
  goHighLevelUpdatedAt: number | undefined
): boolean {
  if (terrosUpdatedAt === undefined || goHighLevelUpdatedAt === undefined) return true
  return goHighLevelUpdatedAt > terrosUpdatedAt
}

export function parseTime(value: string | number | undefined): number | undefined {
  if (value === undefined) return
  const time = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

type AttendeeDecision =
  | { change: 'none'; reason: string }
  | { change: 'unmatched'; goHighLevelUserId: string; reason: string }
  | { change: 'set'; attendeeId: UserId }

/**
 * What the GoHighLevel appointment's assignee means for a Terros event. Pure: the GoHighLevel user and the Terros users
 * are read by the caller.
 */
export function decideAttendee(
  event: Pick<CalendarEventDataWithDetails, 'attendeeId' | 'attendee' | 'updatedAt'>,
  assignedUserId: string | undefined,
  assignee: GoHighLevelUser | undefined,
  goHighLevelUpdatedAt: number | undefined,
  terrosUsers: readonly Pick<SmallUser, 'userId' | 'email'>[]
): AttendeeDecision {
  if (!assignedUserId) return { change: 'none', reason: 'the appointment has no assignee' }

  const email = assignee?.email ? normalizeText(assignee.email) : undefined
  const matches = email ? terrosUsers.filter((user) => normalizeText(user.email) === email) : []
  const match = matches.length === 1 ? matches[0] : undefined
  if (!match) {
    return {
      change: 'unmatched',
      goHighLevelUserId: assignedUserId,
      reason: matches.length > 1 ? 'several Terros users share its email' : 'no Terros user matches its email',
    }
  }

  const currentEmail = event.attendee?.email ? normalizeText(event.attendee.email) : undefined
  if (match.userId === event.attendeeId || (!event.attendeeId && currentEmail === email)) {
    return { change: 'none', reason: 'the attendee already matches' }
  }
  if (!goHighLevelShouldOverwriteAttendee(event.updatedAt, goHighLevelUpdatedAt)) {
    return { change: 'none', reason: 'the Terros event was changed after the appointment' }
  }
  return { change: 'set', attendeeId: match.userId }
}

export async function readTerrosUsers(client: TerrosClient, companyId: CompanyId | undefined): Promise<SmallUser[]> {
  const { users } = await client.user.list(companyId ? { companyId } : {})
  return users
}
