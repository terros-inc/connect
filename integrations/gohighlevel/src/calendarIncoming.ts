import { wrapConnectHandler } from '@terros-inc/sdk'

type ScriptConfig = {
  locationId: string
  calendarId: string
}

type GoHighLevelAppointment = {
  id?: string
  calendarId?: string
  appointmentStatus?: string
  startTime?: string
  endTime?: string
}

type GoHighLevelAppointmentWebhook = {
  type?: string
  locationId?: string
  appointment?: GoHighLevelAppointment
}

type EventTime = {
  eventDate: number
  duration: number
}

export const handler = wrapConnectHandler<GoHighLevelAppointmentWebhook>(async (input, client) => {
  const payload = input.context.payload
  const appointment = payload.appointment
  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig

  if (payload.type !== 'AppointmentUpdate' && payload.type !== 'AppointmentDelete') {
    throw Error(`Unsupported GoHighLevel webhook type ${payload.type ?? '(missing)'}`)
  }

  if (!payload.locationId) throw Error('GoHighLevel appointment webhook is missing locationId')
  if (!appointment?.id) throw Error('GoHighLevel appointment webhook is missing appointment.id')
  if (!appointment.calendarId) throw Error('GoHighLevel appointment webhook is missing appointment.calendarId')

  if (payload.locationId !== scriptConfig.locationId) {
    console.log(`GoHighLevel ${payload.locationId} does not match configured ${scriptConfig.locationId}`)
    return
  }

  if (appointment.calendarId !== scriptConfig.calendarId) {
    console.log(`Skipping appointment ${appointment.id} from calendar ${appointment.calendarId}`)
    return
  }

  const eventTime = toEventTime(appointment)
  const isCanceled = isAppointmentCanceled(payload.type, appointment.appointmentStatus)

  if (isCanceled) {
    const { events } = await client.calendar.event.list({
      startTime: eventTime.eventDate - 1,
      endTime: eventTime.eventDate + eventTime.duration * 60_000 + 1,
    })
    const existingEvent = events.find((event) => event.sourceId === appointment.id)
    if (!existingEvent) {
      console.log(`Skipping cancelled GoHighLevel appointment ${appointment.id} without a matching Terros event`)
      return
    }

    await client.calendar.event.remove({ eventId: existingEvent.eventId })
    console.log(`Removed Terros event ${existingEvent.eventId} for GoHighLevel appointment ${appointment.id}`)
    return
  }

  const { event: updatedEvent } = await client.calendar.event.upsert({
    event: {
      sourceId: appointment.id,
      ...eventTime,
    },
  })
  console.log(`Updated Terros event ${updatedEvent.eventId} from GoHighLevel appointment ${appointment.id}`)
})

export function toEventTime(appointment: Pick<GoHighLevelAppointment, 'startTime' | 'endTime'>): EventTime {
  const eventDate = new Date(appointment.startTime ?? '').getTime()
  const endTime = new Date(appointment.endTime ?? '').getTime()
  const duration = (endTime - eventDate) / 60_000

  if (!Number.isFinite(eventDate) || !Number.isFinite(endTime) || duration <= 0) {
    throw Error('GoHighLevel appointment has invalid startTime or endTime') // spread this into multiple more specific errors
  }

  return { eventDate, duration }
}

export function isAppointmentCanceled(type: string, appointmentStatus: string | undefined): boolean {
  return type === 'AppointmentDelete' || appointmentStatus === 'cancelled'
}
