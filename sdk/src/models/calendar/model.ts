import type { SmallUser, TeamId, UserId } from '../user'
import type { TinyTeam } from '../team'
import type { Address, LatLng } from '../location'
import type { AccountId, DispositionId, LocationId, TinyResidentData, TinyWorkflowAccount } from '../account'

export type CalendarEventId = `Event:${string}` | `Event.${string}`
/** @deprecated */
export type EventOutcomeId = `O.${string}`
export type InterviewId = `Interview:${string}` | `Interview.${string}`
export type AttachmentId = `Attachment:${string}` | `Attachment.${string}`

export type EventType = 'Consultation' | 'Comeback' | 'Interview' | 'GeneralVisit' | 'Shadow' | 'Team'

export type SpecialtyAttachments = {
  utilityBill?: AttachmentId
  customerVerification?: AttachmentId
}

/** @deprecated */
export type SyncedCalendarEvent = {
  calendarType: string
  calendarId: string
  userId: UserId
  deviceId: string
  eventId: string
}

export type CalendarEventLocation = Pick<Address, 'oneLine'> & LatLng

export type UnsavedCalendarEventData = {
  importId?: string
  eventType: EventType
  title: string
  sourceId?: string
  /** UTC milliseconds. */
  eventDate: number
  outcomeId?: EventOutcomeId
  dispositionId?: DispositionId
  /** Minutes. */
  duration: number
  attachments?: AttachmentId[]
  specialtyAttachments?: SpecialtyAttachments
  accountId?: AccountId
  locationId?: LocationId
  location?: CalendarEventLocation
  ownerId?: UserId
  attendeeId?: UserId
  dispatcherId?: UserId
  occurredOwner?: boolean
  occurredAttendee?: boolean
  interviewId?: InterviewId
  /** @deprecated */
  notes?: string
  previousEventId?: CalendarEventId
  /** @deprecated */
  syncedCalendarIds?: string[]
  /** @deprecated */
  syncedCalendarEvents?: SyncedCalendarEvent[]
  teamId?: TeamId
}

export type EventOutcomeHistory = {
  outcomeId: EventOutcomeId
  userId: UserId
  timestamp: number
}

type SitOutcomeFault = string

export type CalendarEventData = UnsavedCalendarEventData & {
  outcomeHistory?: EventOutcomeHistory[]
  createdAt?: number
  createdBy?: UserId
  updatedAt?: number
  updatedBy?: UserId
  eventId: CalendarEventId
  ownerId: UserId
  occurred?: boolean
  closed?: boolean
  reasonNotOccurred?: string
  fault?: SitOutcomeFault
  allDay?: boolean
  canDelete?: boolean
}

export type CalendarEventDataWithDetails = CalendarEventData & {
  resident?: TinyResidentData
  owner?: SmallUser
  attendee?: SmallUser
  teams?: TinyTeam[]
  account?: TinyWorkflowAccount
}
