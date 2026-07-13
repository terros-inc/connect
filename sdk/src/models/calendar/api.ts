import type { AvailableCloser, RoleId, TeamId, TinyCloser, UserId } from '../user'
import type { ApiSuccess } from '../shared'
import type { LatLng } from '../location'
import type { AccountId, LocationId, UpsertLatLng } from '../account'
import type {
  CalendarEventData,
  CalendarEventDataWithDetails,
  CalendarEventId,
  EventType,
  UnsavedCalendarEventData,
} from './model'

type CalendarEventRoleFilter = 'owner' | 'attendee'

type OptionalCalendarEventLocation = UpsertLatLng & {
  locationId?: LocationId
  oneLine?: string
}

/** A yes/no/unset filter — matches events where the field is true, false, unset, or set to any value. */
type BooleanFilter = 'true' | 'false' | 'undefined' | 'defined'

export type CalendarAvailabilityInput = {
  /** UTC milliseconds. */
  startDate: number
  /** Minutes. Defaults to 30. */
  duration?: number
  teamId?: TeamId
}

export type CalendarAvailabilitySuccess = ApiSuccess<{
  available: boolean
}>

export type CalendarClosersInput = CalendarAvailabilityInput & {
  latLng?: LatLng
}

export type CalendarClosersSuccess = ApiSuccess<{
  closers: AvailableCloser[]
}>

export type CalendarTimeslotsInput = {
  targetId?: TeamId | UserId
  days?: number
  locationId?: LocationId
  /** UTC milliseconds. */
  startTime?: number
}

export type CalendarTimeslotsSuccess = ApiSuccess<{
  closers: TinyCloser[]
}>

export type CalendarEventAddInput = {
  event: UnsavedCalendarEventData
  /** Defaults to true. */
  errorOnCloserUnavailable?: boolean
}

export type CalendarEventAddSuccess = ApiSuccess<{
  event: CalendarEventData
}>

export type CalendarEventGetInput = {
  eventId: CalendarEventId
}

export type CalendarEventGetSuccess = ApiSuccess<{
  event: CalendarEventDataWithDetails
}>

export type CalendarEventListInput = {
  startTime?: number
  endTime?: number
  ownerId?: UserId
  locationId?: LocationId
  companyId?: string
  /** @deprecated use teamIds */
  teamId?: TeamId
  teamIds?: TeamId[]
  roleIds?: RoleId[]
  occurred?: BooleanFilter
  closed?: BooleanFilter
  eventType?: EventType
  filterByRoles?: CalendarEventRoleFilter[]
}

export type CalendarEventListSuccess = ApiSuccess<{
  events: CalendarEventDataWithDetails[]
}>

export type CalendarEventUpdateInput = {
  event: Partial<CalendarEventData> & {
    eventId: CalendarEventId
    attendeeId?: UserId | null
  }
  errorOnCloserUnavailable?: boolean
}

export type CalendarEventUpdateSuccess = ApiSuccess<{
  event: CalendarEventData
}>

export type CalendarEventUpsertInput = {
  event: Partial<{
    eventId: CalendarEventId
    sourceId: string
    /** Defaults to 'Consultation' on create. */
    eventType: string
    title: string
    /** Defaults to now on create. */
    eventDate: string | number
    /** An EventOutcomeId, integration mapping string, or case-insensitive name. */
    outcomeId: string
    /** Minutes. */
    duration: number
    accountId: AccountId
    location: OptionalCalendarEventLocation
    /** A UserId or email. Defaults to the authenticated user on create. */
    ownerId: string
    /** A UserId or email. Pass null to clear on update. */
    attendeeId: string | null
    /** A UserId or email. */
    dispatcherId: string
    occurredOwner: boolean
    occurredAttendee: boolean
    notes: string
    previousEventId: CalendarEventId
  }>
}

export type CalendarEventUpsertSuccess = ApiSuccess<{
  event: CalendarEventData
}>

export type CalendarEventConfirmInput = {
  eventId: CalendarEventId
  occurred?: boolean
}

export type CalendarEventConfirmSuccess = ApiSuccess<{
  event: CalendarEventData
}>

export type CalendarEventRemoveInput = {
  archive?: boolean
  eventId: CalendarEventId
}
