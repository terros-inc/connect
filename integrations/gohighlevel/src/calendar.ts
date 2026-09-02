import {
  type AccountId,
  type CalendarEventId,
  type EventType,
  type SmallAddress,
  type TeamId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { getPrivateIntegrationToken } from './util.ts'
import {
  createAppointment,
  findAssignedUserId,
  type GoHighLevelAppointment,
  type GoHighLevelAppointmentInput,
  updateAppointment,
} from './gohighlevel.ts'
import { resolveCalendarRoute, type CalendarRoute } from './config.ts'

type ScriptConfig = {
  teamCalendars: Record<string, string>
}

type Secrets = {
  privateIntegrationTokens: Record<string, string>
}

type CalendarEventWebhookData = {
  id: CalendarEventId
  owner?: {
    email?: string
    teamIds?: TeamId[]
  }
  eventDate: string
  account?: {
    accountId: AccountId
    externalLeadId?: string
  }
  duration: number
  title: string
  eventType: EventType
  address?: SmallAddress
  attendee?: {
    email?: string
  }
  sourceId?: string
}

type CalendarEventWebhook =
  | {
      entity: 'Event'
      action: 'add' | 'update'
      data: CalendarEventWebhookData
    }
  | {
      entity: 'Event'
      action: 'remove'
      data: { id: CalendarEventId }
    }

type AppointmentEvent = Pick<CalendarEventWebhookData, 'title' | 'eventDate' | 'duration' | 'address'>

export const handler = wrapConnectHandler<CalendarEventWebhook>(async (input, client) => {
  const payload = input.context.payload

  if (payload.action === 'remove') {
    console.log(`Skipping GoHighLevel sync for removed Terros event ${payload.data.id}`)
    return
  }

  const event = payload.data

  if (event.eventType !== 'Consultation') {
    console.log(`Skipping non-consultation Terros event ${event.id}`)
    return
  }
  const teamId = event.owner?.teamIds?.[0]
  if (!teamId) throw Error(`Terros event ${event.id} owner has no teamId`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const { team } = await client.team.get({ teamId })
  console.log(`Using team ${team.teamId}`)
  const route = resolveCalendarRoute(scriptConfig, team)
  console.log(`Resolved ${team.teamId} to ${route.locationId} and ${route.calendarId}`)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, route.locationId)

  if (!event.account) throw Error(`Terros event ${event.id} has no account`)
  if (!event.account.externalLeadId) {
    throw Error(`Account ${event.account.accountId} has no synced contact ID`)
  }
  console.log(`Using contact ${event.account.externalLeadId} from ${event.account.accountId} for ${event.id}`)

  const assignedUserId = await findAssignedUserId(
    accessToken,
    route.locationId,
    event.attendee?.email || event.owner?.email
  )
  const appointmentInput = toAppointmentInput(event, route, event.account.externalLeadId, assignedUserId)

  if (event.sourceId) {
    const updatedAppointment = await updateExistingAppointment(accessToken, event.sourceId, appointmentInput)
    console.log(`Updated appointment ${updatedAppointment.id} for event ${event.id}`)
    return
  }

  const createdAppointment = await createAppointment(accessToken, appointmentInput)
  await client.calendar.event.update({
    event: {
      eventId: event.id,
      sourceId: createdAppointment.id,
    },
  })
  console.log(`Created appointment ${createdAppointment.id} for ${event.id}`)
})

export function toAppointmentInput(
  event: AppointmentEvent,
  route: CalendarRoute,
  contactId: string,
  assignedUserId: string | undefined
): GoHighLevelAppointmentInput {
  const startTime = new Date(event.eventDate)
  const endTime = new Date(startTime.getTime() + event.duration * 60_000)

  return {
    calendarId: route.calendarId,
    locationId: route.locationId,
    contactId,
    title: event.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    appointmentStatus: 'confirmed',
    assignedUserId,
    address: event.address?.line1,
    toNotify: true,
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
  }
}

async function updateExistingAppointment(
  accessToken: string,
  appointmentId: string,
  appointment: GoHighLevelAppointmentInput
): Promise<GoHighLevelAppointment> {
  const { locationId: _locationId, contactId: _contactId, ...appointmentUpdate } = appointment
  return await updateAppointment(accessToken, appointmentId, appointmentUpdate)
}
