import { DateTime } from 'luxon'
import { wrapConnectHandler } from '@terros-inc/sdk'

type ScriptConfig = {
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
  user?: {
    email?: string
  }
  calendar?: GoHighLevelWorkflowCalendar
}

type EventTime = {
  startDate: number
  endDate: number
  duration: number
}

export const handler = wrapConnectHandler<GoHighLevelAppointmentWebhook>(async (input, client) => {
  const payload = input.context.payload
  const appointment = payload.calendar
  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const payloadFields = Object.keys(payload).sort().join(', ') || '(none)'
  const locationId = payload.location?.id

  console.log(`Received Appointment webhook: `, payload)

  if (!locationId) throw Error('Appointment is missing location ID')
  if (!appointment) {
    throw Error(`Missing appointment data; received fields: ${payloadFields}`)
  }
  if (!appointment.appointmentId) throw Error('Appointment is missing calendar.appointmentId')
  if (!appointment.id) throw Error('Appointment is missing calendar.id')

  if (locationId !== scriptConfig.locationId) {
    console.log(`${locationId} does not match ${scriptConfig.locationId}`)
    return
  }

  if (appointment.id !== scriptConfig.calendarId) {
    console.log(`Skipping ${appointment.appointmentId} from ${appointment.id}`)
    return
  }

  const eventTime = toEventTime(appointment)

  if (appointment.appoinmentStatus === 'cancelled' || appointment.status === 'cancelled') {
    const userEmail = payload.user?.email
    if (!userEmail) throw Error('Appointment is missing user.email')
    const { user } = await client.user.get({ userId: userEmail })
    const { events } = await client.calendar.event.list({
      ownerId: user.userId,
      startTime: eventTime.startDate - 1,
      endTime: eventTime.endDate + 1,
      eventType: 'Consultation',
    })
    const existingEvent = events.find((event) => event.sourceId === appointment.appointmentId)
    if (!existingEvent) {
      console.log(`Skipping canceled ${appointment.appointmentId} without a matching event`)
      return
    }

    await client.calendar.event.remove({ eventId: existingEvent.eventId })
    console.log(`Removed ${existingEvent.eventId} for ${appointment.appointmentId}`)
    return
  }

  const { event: updatedEvent } = await client.calendar.event.upsert({
    event: {
      sourceId: appointment.appointmentId,
      eventDate: eventTime.startDate,
      duration: eventTime.duration,
    },
  })
  console.log(`Updated ${updatedEvent.eventId} from ${appointment.appointmentId}`)
})

export function toEventTime(
  appointment: Pick<GoHighLevelWorkflowCalendar, 'startTime' | 'endTime' | 'selectedTimezone'>
): EventTime {
  if (!appointment.startTime) throw Error('Appointment is missing startTime')
  if (!appointment.endTime) throw Error('Appointment is missing endTime')
  if (!appointment.selectedTimezone) throw Error('Appointment is missing selectedTimezone')

  const startTime = DateTime.fromISO(appointment.startTime, { zone: appointment.selectedTimezone })
  if (!startTime.isValid) throw Error(`Invalid startTime: ${startTime.invalidExplanation}`)

  const endTime = DateTime.fromISO(appointment.endTime, { zone: appointment.selectedTimezone })
  if (!endTime.isValid) throw Error(`Invalid endTime: ${endTime.invalidExplanation}`)

  const startDate = startTime.toMillis()
  const endDate = endTime.toMillis()
  const duration = endTime.diff(startTime, 'minutes').minutes
  if (duration <= 0) throw Error('Appointment endTime must be after startTime')

  return { startDate, endDate, duration }
}
