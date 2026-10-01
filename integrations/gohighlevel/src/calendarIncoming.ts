import { DateTime } from 'luxon'
import {
  type CalendarEventDataWithDetails,
  type CompanyId,
  type TerrosClient,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { isCreatingMarker } from './creationGuard.ts'
import { checkConfig } from './configFields.ts'
import { isSwitchOn, type RunSwitches } from './config.ts'

type ScriptConfig = RunSwitches & {
  locationId: string
  calendarId: string
}

type GoHighLevelWorkflowCalendar = {
  id?: string
  appointmentId?: string
  appoinmentStatus?: string
  status?: string
  startTime?: string
  endTime?: string
  selectedTimezone?: string
}

type GoHighLevelAppointmentWebhook = {
  location?: {
    id?: string
  }
  calendar?: GoHighLevelWorkflowCalendar
}

type EventTime = {
  startDate: number
  endDate: number
  duration: number
}

export const handler = wrapConnectHandler<GoHighLevelAppointmentWebhook, void, ScriptConfig>(async (input, client) => {
  const payload = input.context.payload
  const appointment = payload.calendar
  const scriptConfig = input.context.config.scriptConfig
  if (isSwitchOn('disabled', scriptConfig.disabled)) {
    console.log('GoHighLevel Appointment Webhook is disabled by config, skipping')
    return
  }
  checkConfig('appointmentWebhook', scriptConfig)
  const dryRun = isSwitchOn('dryRun', scriptConfig.dryRun)
  const payloadFields = Object.keys(payload).sort().join(', ') || '(none)'
  const locationId = payload.location?.id

  if (!locationId) throw Error('Appointment is missing location ID')
  if (!appointment) {
    throw Error(`Missing appointment data; received fields: ${payloadFields}`)
  }
  if (!appointment.appointmentId) throw Error('Appointment is missing calendar.appointmentId')
  if (!appointment.id) throw Error('Appointment is missing calendar.id')

  if (locationId !== scriptConfig.locationId) {
    console.log(`${locationId} does not match configured ${scriptConfig.locationId}`)
    return
  }

  if (appointment.id !== scriptConfig.calendarId) {
    console.log(`Skipping ${appointment.appointmentId} from ${appointment.id}`)
    return
  }

  // A Terros event holds a creation marker, never a real appointment id, while Terros is creating the appointment.
  if (isCreatingMarker(appointment.appointmentId)) {
    console.log(`Skipping ${appointment.appointmentId}: not a GoHighLevel appointment id`)
    return
  }

  const eventTime = isCancelled(appointment) ? undefined : toEventTime(appointment)
  const existingEvent = await findLinkedEvent(client, appointment)
  if (!existingEvent) {
    console.log(`No Terros event is linked to GoHighLevel appointment ${appointment.appointmentId}, skipping`)
    return
  }

  if (dryRun) {
    console.log(
      `DRY RUN: would ${eventTime ? `update ${existingEvent.eventId} to ${JSON.stringify(eventTime)}` : `remove ${existingEvent.eventId}`} for ${appointment.appointmentId}; nothing was written`
    )
    return
  }

  if (!eventTime) {
    await client.calendar.event.remove({ eventId: existingEvent.eventId })
    console.log(`Removed ${existingEvent.eventId} for cancelled ${appointment.appointmentId}`)
    return
  }

  const { event: updatedEvent } = await client.calendar.event.upsert({
    event: {
      eventId: existingEvent.eventId,
      eventDate: eventTime.startDate,
      duration: eventTime.duration,
    },
  })
  console.log(`Updated ${updatedEvent.eventId} from ${appointment.appointmentId}`)
})

const day = 24 * 60 * 60 * 1000
// The list API cannot filter by sourceId or search without a date range, so widen the window until the link is found.
const linkedEventWindowsMs = [90 * day, 730 * day]

function isCancelled(appointment: GoHighLevelWorkflowCalendar): boolean {
  return appointment.appoinmentStatus === 'cancelled' || appointment.status === 'cancelled'
}

// Finds the Terros event linked by sourceId without ever creating one. The Terros event still has the previous time when
// GoHighLevel reschedules it, so the window is centered on the new time and widened if nothing matches. The list is
// scoped to the company because without a companyId it returns only the authenticated user's own events.
async function findLinkedEvent(
  client: TerrosClient,
  appointment: GoHighLevelWorkflowCalendar
): Promise<CalendarEventDataWithDetails | undefined> {
  const startTime = appointment.startTime
    ? DateTime.fromISO(appointment.startTime, {
        zone: appointment.selectedTimezone ?? 'utc',
      })
    : undefined
  const center = startTime?.isValid ? startTime.toMillis() : Date.now()
  // The company lookup needs company:read for the caller. Incoming scripts run with the webhook key's own user, which
  // may lack it; fall back to an unscoped list (the key user's own events) rather than failing every webhook.
  const companyId = await readCompanyId(client)
  for (const windowMs of linkedEventWindowsMs) {
    const { events } = await client.calendar.event.list({
      companyId,
      startTime: center - windowMs,
      endTime: center + windowMs,
      eventType: 'Consultation',
    })
    const event = events.find((event) => event.sourceId === appointment.appointmentId)
    if (event) return event
  }
}

async function readCompanyId(client: TerrosClient): Promise<CompanyId | undefined> {
  try {
    const { company } = await client.company.get({})
    return company.companyId
  } catch (error) {
    console.error(
      `Could not read the company, so linked events are searched without a company scope and may be missed: ${error instanceof Error ? error.message : error}`
    )
  }
}

export function toEventTime(
  appointment: Pick<GoHighLevelWorkflowCalendar, 'startTime' | 'endTime' | 'selectedTimezone'>
): EventTime {
  if (!appointment.startTime) throw Error('Appointment is missing startTime')
  if (!appointment.endTime) throw Error('Appointment is missing endTime')
  if (!appointment.selectedTimezone) throw Error('Appointment is missing selectedTimezone')

  const startTime = DateTime.fromISO(appointment.startTime, {
    zone: appointment.selectedTimezone,
  })
  if (!startTime.isValid) throw Error(`Invalid startTime: ${startTime.invalidExplanation}`)

  const endTime = DateTime.fromISO(appointment.endTime, {
    zone: appointment.selectedTimezone,
  })
  if (!endTime.isValid) throw Error(`Invalid endTime: ${endTime.invalidExplanation}`)

  const startDate = startTime.toMillis()
  const endDate = endTime.toMillis()
  const duration = endTime.diff(startTime, 'minutes').minutes
  if (duration <= 0) throw Error('Appointment endTime must be after startTime')

  return { startDate, endDate, duration }
}
