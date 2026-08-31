import {
  type CalendarEventDataWithDetails,
  type TerrosClient,
  type WebhookPayload,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { getLocationAccessToken } from './util.ts'
import {
  createAppointment,
  findAssignedUserId,
  type GoHighLevelAppointment,
  type GoHighLevelAppointmentInput,
  updateAppointment,
} from './gohighlevel.ts'
import { resolveCalendarRoute, type CalendarRoute } from './config.ts'

type ScriptConfig = {
  goHighLevelCompanyId: string
  teamLocations: Record<string, string>
  teamCalendars: Record<string, string>
}

type CalendarEventWebhook = WebhookPayload<'Event', CalendarEventDataWithDetails, 'eventId'>
type AppointmentEvent = Pick<CalendarEventDataWithDetails, 'title' | 'eventDate' | 'duration' | 'location'>

export const handler = wrapConnectHandler<CalendarEventWebhook>(async (input, client) => {
  const payload = input.context.payload
  const event =
    payload.action === 'remove' ? (await client.calendar.event.get({ eventId: payload.data })).event : payload.data

  if (event.eventType !== 'Consultation') {
    console.log(`Skipping non-consultation Terros event ${event.eventId}`)
    return
  }
  if (!event.teamId) throw Error(`Terros event ${event.eventId} has no teamId`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const route = resolveCalendarRoute(scriptConfig, event.teamId)
  const agencyAccessToken = input.context.config.secrets.agencyAccessToken
  if (!agencyAccessToken) throw Error('Missing GoHighLevel agencyAccessToken')
  if (!scriptConfig.goHighLevelCompanyId) throw Error('Missing goHighLevelCompanyId')
  const accessToken = await getLocationAccessToken(
    agencyAccessToken,
    scriptConfig.goHighLevelCompanyId,
    route.locationId
  )

  if (payload.action === 'remove') {
    if (!event.sourceId) {
      console.log(`Skipping GoHighLevel cancellation for unsynced Terros event ${event.eventId}`)
      return
    }
    await updateAppointment(accessToken, event.sourceId, { appointmentStatus: 'cancelled', toNotify: true })
    console.log(`Cancelled GoHighLevel appointment ${event.sourceId} for removed Terros event ${event.eventId}`)
    return
  }

  if (!event.accountId) throw Error(`Terros event ${event.eventId} has no accountId`)
  const { account } = await client.account.get({ accountId: event.accountId })
  if (!account.externalLeadId) {
    throw Error(`Terros account ${event.accountId} has no synced GoHighLevel contact ID`)
  }

  const assignedUserId = await findAssignedUserId(
    accessToken,
    route.locationId,
    event.attendee?.email || event.owner?.email
  )
  const appointmentInput = toAppointmentInput(event, route, account.externalLeadId, assignedUserId)
  const existingAppointmentId = await getExistingAppointmentId(client, event)

  if (existingAppointmentId) {
    const updatedAppointment = await updateExistingAppointment(accessToken, existingAppointmentId, appointmentInput)
    if (!event.sourceId) {
      await client.calendar.event.update({
        event: {
          eventId: event.eventId,
          sourceId: updatedAppointment.id,
        },
      })
    }
    console.log(`Updated GoHighLevel appointment ${updatedAppointment.id} for Terros event ${event.eventId}`)
    return
  }

  const createdAppointment = await createAppointment(accessToken, appointmentInput)
  await client.calendar.event.update({
    event: {
      eventId: event.eventId,
      sourceId: createdAppointment.id,
    },
  })
  console.log(`Created GoHighLevel appointment ${createdAppointment.id} for Terros event ${event.eventId}`)
})

export function toAppointmentInput(
  event: AppointmentEvent,
  route: CalendarRoute,
  contactId: string,
  assignedUserId: string | undefined
): GoHighLevelAppointmentInput {
  const startTime = new Date(event.eventDate)
  const endTime = new Date(event.eventDate + event.duration * 60_000)

  return {
    calendarId: route.calendarId,
    locationId: route.locationId,
    contactId,
    title: event.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    appointmentStatus: 'confirmed',
    assignedUserId,
    address: event.location?.oneLine,
    toNotify: true,
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
  }
}

async function getExistingAppointmentId(
  client: TerrosClient,
  event: CalendarEventDataWithDetails
): Promise<string | undefined> {
  if (event.sourceId) return event.sourceId
  if (!event.previousEventId) return

  const { event: previousEvent } = await client.calendar.event.get({ eventId: event.previousEventId })
  return previousEvent.sourceId
}

async function updateExistingAppointment(
  accessToken: string,
  appointmentId: string,
  appointment: GoHighLevelAppointmentInput
): Promise<GoHighLevelAppointment> {
  const { locationId: _locationId, contactId: _contactId, ...appointmentUpdate } = appointment
  return await updateAppointment(accessToken, appointmentId, appointmentUpdate)
}
