import {
  type AccountId,
  type CalendarEventId,
  type EventType,
  type SmallAddress,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { ghlApi } from './util.ts'
import {
  findOpportunity,
  findStage,
  findUserId,
  getPipeline,
  needsUpdate,
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
}

type GoHighLevelContact = {
  id: string
}

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

  if (!event.account) throw Error(`Terros event ${event.id} has no account`)
  const { account } = await client.account.get({ accountId: event.account.accountId })
  const closer = event.attendee
  if (!closer) throw Error(`${event.id} has no attendee`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = secrets.privateIntegrationToken

  if (!account.workflowStageName) throw Error(`${account.accountId} has no workflow stage name`)

  const assignedUserId = await findUserId(accessToken, scriptConfig.locationId, closer.email)
  let contactId = account.externalLeadId
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
    console.log('Created contact:', contactResponse)
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

  if (event.sourceId) {
    const { locationId: _locationId, contactId: _contactId, ...appointmentUpdate } = appointmentInput

    const updatedAppointment = await ghlApi<GoHighLevelAppointment>(
      accessToken,
      `/calendars/events/appointments/${event.sourceId}`,
      {
        method: 'PUT',
        body: JSON.stringify(appointmentUpdate),
      }
    )
    console.log('Updated Appointment: ', updatedAppointment)
  } else {
    const createdAppointment = await ghlApi<GoHighLevelAppointment>(accessToken, '/calendars/events/appointments', {
      method: 'POST',
      body: JSON.stringify(appointmentInput),
    })
    console.log('Created Appointment: ', createdAppointment)
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
    console.log('Create opportunity:', opportunityInput)
    const createdOpportunity = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, '/opportunities/', {
      method: 'POST',
      body: JSON.stringify(opportunityInput),
    })
    console.log(createdOpportunity)
    return
  }

  if (!needsUpdate(existingOpportunity, opportunityInput)) {
    console.log(`Skipped update: ${existingOpportunity.id} for ${account.accountId}`)
    return
  }

  const { locationId: _locationId, contactId: _contactId, ...opportunityUpdate } = opportunityInput
  console.log('Opportunity update:', opportunityUpdate)
  const updatedOpportunity = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(
    accessToken,
    `/opportunities/${existingOpportunity.id}`,
    {
      method: 'PUT',
      body: JSON.stringify(opportunityUpdate),
    }
  )
  console.log(updatedOpportunity)
})

type AppointmentEvent = Pick<CalendarEventWebhookData, 'title' | 'eventDate' | 'duration' | 'address'>

type GoHighLevelAppointmentInput = {
  calendarId: string
  locationId: string
  contactId: string
  title: string
  startTime: string
  endTime: string
  appointmentStatus: 'confirmed'
  assignedUserId?: string
  address?: string
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
    address: event.address?.line1,
    toNotify: true,
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
  }
}
