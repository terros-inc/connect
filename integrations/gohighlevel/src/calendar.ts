import {
  type AccountData,
  type AccountId,
  type CalendarEventId,
  type EventType,
  type SmallAddress,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { readTrimmedString } from './util.ts'
import {
  createAppointment,
  createOpportunity,
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getPipeline,
  type GoHighLevelAppointmentInput,
  type GoHighLevelOpportunityInput,
  opportunityNeedsUpdate,
  updateAppointment,
  updateOpportunity,
} from './gohighlevel.ts'
import { resolveGoHighLevelStageName } from './config.ts'

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

type AppointmentEvent = Pick<CalendarEventWebhookData, 'title' | 'eventDate' | 'duration' | 'address'>
type OpportunityAccount = Pick<AccountData, 'accountId' | 'resident' | 'workflowStageName'>

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

  if (!account.externalLeadId) {
    throw Error(`${account.accountId} has no contact ID`)
  }
  if (!account.workflowStageName) throw Error(`${account.accountId} has no workflow stage name`)
  console.log(`Using ${account.externalLeadId} for ${event.id}`)

  const assignedUserId = await findAssignedUserId(accessToken, scriptConfig.locationId, closer.email)
  const appointmentInput = toAppointmentInput(event, scriptConfig, account.externalLeadId, assignedUserId)

  if (event.sourceId) {
    const { locationId: _locationId, contactId: _contactId, ...appointmentUpdate } = appointmentInput
    console.log('Appointment update:', appointmentUpdate)
    const updatedAppointment = await updateAppointment(accessToken, event.sourceId, appointmentUpdate)
    console.log(updatedAppointment)
  } else {
    console.log('Create appointment:', appointmentInput)
    const createdAppointment = await createAppointment(accessToken, appointmentInput)
    console.log(createdAppointment)
    await client.calendar.event.update({
      event: {
        eventId: event.id,
        sourceId: createdAppointment.id,
      },
    })
  }

  const pipeline = await getPipeline(accessToken, scriptConfig.locationId, scriptConfig.pipelineId)
  const stageName = resolveGoHighLevelStageName(account.workflowStageName, scriptConfig.stageMappings)
  const stage = findPipelineStage(pipeline, stageName)
  console.log(`Resolved ${account.workflowStageName} to stage ${stage.name} (${stage.id}) in ${pipeline.id}`)
  const existingOpportunity = await findOpportunity(accessToken, scriptConfig, account.externalLeadId)
  const opportunityInput = toOpportunityInput(account, scriptConfig, account.externalLeadId, stage.id, assignedUserId)

  if (!existingOpportunity) {
    console.log('Create opportunity:', opportunityInput)
    const createdOpportunity = await createOpportunity(accessToken, opportunityInput)
    console.log(createdOpportunity)
    return
  }

  if (!opportunityNeedsUpdate(existingOpportunity, opportunityInput)) {
    console.log(`Skipped ${existingOpportunity.id} for ${account.accountId}`)
    return
  }

  const { locationId: _locationId, contactId: _contactId, ...opportunityUpdate } = opportunityInput
  console.log('Opportunity update:', opportunityUpdate)
  const updatedOpportunity = await updateOpportunity(accessToken, existingOpportunity.id, opportunityUpdate)
  console.log(updatedOpportunity)
})

export function toAppointmentInput(
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

export function toOpportunityInput(
  account: OpportunityAccount,
  config: Pick<ScriptConfig, 'locationId' | 'pipelineId'>,
  contactId: string,
  pipelineStageId: string,
  assignedTo: string | undefined
): GoHighLevelOpportunityInput {
  const firstName = readTrimmedString(account.resident?.firstName) || ''
  const lastName = readTrimmedString(account.resident?.lastName) || ''
  const name =
    `${firstName} ${lastName}`.trim() ||
    readTrimmedString(account.resident?.name) ||
    `Terros Account ${account.accountId}`

  return {
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    pipelineStageId,
    contactId,
    name,
    status: 'open',
    assignedTo,
  }
}
