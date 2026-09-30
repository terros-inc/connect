import {
  type AccountId,
  type CalendarEventId,
  type EventType,
  type SmallAddress,
  type TerrosClient,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { ghlApi, isNotFound } from './util.ts'
import {
  findOpportunity,
  findStage,
  findUserId,
  getOpportunityUpdate,
  getPipeline,
  toContact,
  toOpportunity,
  type GoHighLevelOpportunity,
} from './gohighlevel.ts'
import { toGhlStage } from './config.ts'

type ScriptConfig = {
  locationId: string
  calendarId: string
  pipelineId: string
  stageMappings?: Record<string, string>
}

type Secrets = {
  privateIntegrationToken: string
}

type CalendarEventWebhookData = {
  id: CalendarEventId
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

type GoHighLevelAppointment = {
  id: string
  calendarId: string
  locationId: string
  contactId: string
  title: string
  startTime: string
  endTime: string
  appointmentStatus: string
  assignedUserId?: string
}

type GoHighLevelContact = {
  id: string
  locationId?: string
}

export const handler = wrapConnectHandler<CalendarEventWebhook>(async (input, client) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = secrets.privateIntegrationToken

  if (payload.action === 'remove') {
    await cancelAppointment(client, accessToken, scriptConfig, payload.data.id)
    return
  }

  const event = payload.data

  if (event.eventType !== 'Consultation') {
    console.log(`Skipping non-consultation Terros event ${event.id}`)
    return
  }

  if (!event.account) {
    console.log(`Skipping Terros event ${event.id}: no account yet`)
    return
  }
  const closer = event.attendee
  if (!closer) {
    console.log(`Skipping Terros event ${event.id}: no attendee yet`)
    return
  }

  const { account } = await client.account.get({ accountId: event.account.accountId })
  if (!account.workflowStageName) {
    console.log(`Skipping Terros event ${event.id}: ${account.accountId} has no workflow stage yet`)
    return
  }

  const assignedUserId = await findUserId(accessToken, scriptConfig.locationId, closer.email)
  if (!assignedUserId) {
    throw Error(
      `No GoHighLevel user matches the attendee email ${closer.email ?? '(none)'} for Terros event ${event.id}`
    )
  }

  let contactId = await findValidContactId(accessToken, scriptConfig.locationId, account.externalLeadId)
  if (!contactId) {
    const contactInput = toContact(
      {
        address: account.location,
        resident: account.resident,
      },
      scriptConfig.locationId,
      undefined,
      assignedUserId
    )
    const contactResponse = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, '/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify(contactInput),
    })
    contactId = contactResponse.contact.id

    await client.account.upsert({
      requestType: 'update',
      account: {
        accountId: account.accountId,
        externalLeadId: contactId,
      },
    })
    console.log(`Saved contact ${contactId} to ${account.accountId}`)
  }
  console.log(`Using ${contactId} for ${event.id}`)

  const appointmentInput = toAppointment(event, scriptConfig, contactId, assignedUserId)

  const existingAppointment = event.sourceId ? await findAppointment(accessToken, event.sourceId) : undefined
  if (event.sourceId && !existingAppointment) {
    console.log(`GoHighLevel appointment ${event.sourceId} was not found, creating a new one`)
  }

  if (event.sourceId && existingAppointment) {
    const appointmentUpdate = getAppointmentUpdate(existingAppointment, appointmentInput)
    if (appointmentUpdate) {
      await ghlApi<GoHighLevelAppointment>(accessToken, `/calendars/events/appointments/${event.sourceId}`, {
        method: 'PUT',
        body: JSON.stringify(appointmentUpdate),
      })
    } else {
      console.log(`Skipped unchanged GoHighLevel appointment ${event.sourceId}`)
    }
  } else {
    const createdAppointment = await ghlApi<GoHighLevelAppointment>(accessToken, '/calendars/events/appointments', {
      method: 'POST',
      body: JSON.stringify(appointmentInput),
    })
    await client.calendar.event.update({
      event: {
        eventId: event.id,
        sourceId: createdAppointment.id,
      },
    })
  }

  const pipeline = await getPipeline(accessToken, scriptConfig.locationId, scriptConfig.pipelineId)
  const stageName = toGhlStage(account.workflowStageName, scriptConfig.stageMappings)
  const stage = findStage(pipeline, stageName)
  console.log(`Resolved ${account.workflowStageName} to stage ${stage.name} (${stage.id}) in ${pipeline.id}`)
  const existingOpportunity = await findOpportunity(accessToken, scriptConfig, contactId)
  const opportunityInput = toOpportunity(account, scriptConfig, contactId, stage.id, assignedUserId)

  if (!existingOpportunity) {
    const createdOpportunity = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, '/opportunities/', {
      method: 'POST',
      body: JSON.stringify(opportunityInput),
    })
    return
  }

  const opportunityUpdate = getOpportunityUpdate(existingOpportunity, assignedUserId)
  if (!opportunityUpdate) {
    console.log(`Left GoHighLevel opportunity ${existingOpportunity.id} as is for ${account.accountId}`)
    return
  }

  await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, `/opportunities/${existingOpportunity.id}`, {
    method: 'PUT',
    body: JSON.stringify(opportunityUpdate),
  })
})

async function findAppointment(
  accessToken: string,
  appointmentId: string
): Promise<GoHighLevelAppointment | undefined> {
  try {
    const { event } = await ghlApi<{ event: GoHighLevelAppointment }>(
      accessToken,
      `/calendars/events/appointments/${appointmentId}`
    )
    return event
  } catch (error) {
    if (isNotFound(error)) return
    throw error
  }
}

// A contact id saved by another location or since deleted is not usable; the caller relinks via upsert.
async function findValidContactId(
  accessToken: string,
  locationId: string,
  externalLeadId: string | undefined
): Promise<string | undefined> {
  if (!externalLeadId) return

  try {
    const { contact } = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, `/contacts/${externalLeadId}`)
    if (contact.locationId === locationId) return externalLeadId
    console.log(`Contact ${externalLeadId} belongs to location ${contact.locationId}, relinking`)
  } catch (error) {
    if (!isNotFound(error)) throw error
    console.log(`Contact ${externalLeadId} was not found, relinking`)
  }
}

// Terros events are archived on remove, so the event can still be read to find its appointment.
async function cancelAppointment(
  client: TerrosClient,
  accessToken: string,
  scriptConfig: ScriptConfig,
  eventId: CalendarEventId
): Promise<void> {
  const { event } = await client.calendar.event.get({ eventId })
  if (!event.sourceId) {
    console.log(`Skipping removed Terros event ${eventId}: no GoHighLevel appointment`)
    return
  }

  const appointment = await findAppointment(accessToken, event.sourceId)
  if (!appointment || appointment.calendarId !== scriptConfig.calendarId) {
    console.log(`Skipping removed Terros event ${eventId}: ${event.sourceId} is not on the configured calendar`)
    return
  }
  if (appointment.appointmentStatus === 'cancelled') {
    console.log(`GoHighLevel appointment ${event.sourceId} is already cancelled`)
    return
  }

  await ghlApi<GoHighLevelAppointment>(accessToken, `/calendars/events/appointments/${event.sourceId}`, {
    method: 'PUT',
    body: JSON.stringify({ appointmentStatus: 'cancelled' }),
  })
  console.log(`Cancelled GoHighLevel appointment ${event.sourceId} for removed Terros event ${eventId}`)
}

type AppointmentEvent = Pick<CalendarEventWebhookData, 'title' | 'eventDate' | 'duration'>

type GoHighLevelAppointmentInput = {
  calendarId: string
  locationId: string
  contactId: string
  title: string
  startTime: string
  endTime: string
  appointmentStatus: 'confirmed'
  assignedUserId?: string
  meetingLocationType: 'gmeet'
  toNotify: true
  ignoreDateRange: true
  ignoreFreeSlotValidation: true
}

export function toAppointment(
  event: AppointmentEvent,
  config: Pick<ScriptConfig, 'locationId' | 'calendarId'>,
  contactId: string,
  assignedUserId: string | undefined
): GoHighLevelAppointmentInput {
  const startTime = new Date(event.eventDate)
  const endTime = new Date(startTime.getTime() + event.duration * 60_000)

  return {
    calendarId: config.calendarId,
    locationId: config.locationId,
    contactId,
    title: event.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    appointmentStatus: 'confirmed',
    assignedUserId,
    meetingLocationType: 'gmeet',
    toNotify: true,
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
  }
}

type GoHighLevelAppointmentUpdate = Partial<
  Pick<
    GoHighLevelAppointmentInput,
    'startTime' | 'endTime' | 'assignedUserId' | 'ignoreDateRange' | 'ignoreFreeSlotValidation'
  >
> & { toNotify?: true }

/**
 * GoHighLevel owns an existing appointment's status and title. Terros may only move it in time and fill in a missing
 * assignee; returns undefined when there is nothing to send.
 */
export function getAppointmentUpdate(
  appointment: GoHighLevelAppointment,
  input: GoHighLevelAppointmentInput
): GoHighLevelAppointmentUpdate | undefined {
  const timeChanged =
    new Date(appointment.startTime).getTime() !== new Date(input.startTime).getTime() ||
    new Date(appointment.endTime).getTime() !== new Date(input.endTime).getTime()
  const assigneeMissing = !appointment.assignedUserId && input.assignedUserId !== undefined
  if (!timeChanged && !assigneeMissing) return

  return {
    ...(timeChanged
      ? {
          startTime: input.startTime,
          endTime: input.endTime,
          toNotify: true,
          ignoreDateRange: true,
          ignoreFreeSlotValidation: true,
        }
      : {}),
    ...(assigneeMissing ? { assignedUserId: input.assignedUserId } : {}),
  }
}
