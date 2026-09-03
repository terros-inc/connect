import {
  type AccountData,
  type AccountId,
  type CalendarEventId,
  type EventType,
  type SmallAddress,
  type TeamId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { getPrivateIntegrationToken, readTrimmedString } from './util.ts'
import {
  createAppointment,
  createOpportunity,
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getPipeline,
  type GoHighLevelAppointment,
  type GoHighLevelAppointmentInput,
  type GoHighLevelOpportunityInput,
  opportunityNeedsUpdate,
  updateAppointment,
  updateOpportunity,
} from './gohighlevel.ts'
import { resolveCalendarRoute, resolveGoHighLevelStageName, type CalendarRoute } from './config.ts'

type ScriptConfig = {
  teamCalendars: Record<string, string>
  teamPipelines: Record<string, string>
  stageMappings?: Record<string, string>
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
    teamIds?: TeamId[]
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
  const assignedTerrosUser = event.attendee ?? event.owner
  const teamId = assignedTerrosUser?.teamIds?.[0]
  if (!teamId) throw Error(`Terros event ${event.id} attendee or owner has no teamId`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const { team } = await client.team.get({ teamId })
  console.log(`Using team ${team.teamId}`)
  const route = resolveCalendarRoute(scriptConfig, team)
  console.log(`Resolved ${team.teamId} to ${route.locationId} and ${route.calendarId}`)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, route.locationId)

  if (!account.externalLeadId) {
    throw Error(`${account.accountId} has no contact ID`)
  }
  if (!account.workflowStageName) throw Error(`${account.accountId} has no workflow stage name`)
  console.log(`Using ${account.externalLeadId} for ${event.id}`)

  const assignedUserId = await findAssignedUserId(accessToken, route.locationId, assignedTerrosUser.email)
  const appointmentInput = toAppointmentInput(event, route, account.externalLeadId, assignedUserId)

  if (event.sourceId) {
    const updatedAppointment = await updateExistingAppointment(accessToken, event.sourceId, appointmentInput)
    console.log(`Updated appointment ${updatedAppointment.id} for event ${event.id}`)
  } else {
    const createdAppointment = await createAppointment(accessToken, appointmentInput)
    await client.calendar.event.update({
      event: {
        eventId: event.id,
        sourceId: createdAppointment.id,
      },
    })
    console.log(`Created appointment ${createdAppointment.id} for ${event.id}`)
  }

  const pipeline = await getPipeline(accessToken, route.locationId, route.pipelineId)
  const stageName = resolveGoHighLevelStageName(account.workflowStageName, scriptConfig.stageMappings)
  const stage = findPipelineStage(pipeline, stageName)
  console.log(`Resolved ${account.workflowStageName} to stage ${stage.name} (${stage.id}) in ${pipeline.id}`)
  const existingOpportunity = await findOpportunity(accessToken, route, account.externalLeadId)
  const opportunityInput = toOpportunityInput(account, route, account.externalLeadId, stage.id, assignedUserId)

  if (!existingOpportunity) {
    const createdOpportunity = await createOpportunity(accessToken, opportunityInput)
    console.log(`Created ${createdOpportunity.id} for ${account.accountId}`)
    return
  }

  if (!opportunityNeedsUpdate(existingOpportunity, opportunityInput)) {
    console.log(`Skipped ${existingOpportunity.id} for ${account.accountId}`)
    return
  }

  const updatedOpportunity = await updateOpportunity(accessToken, existingOpportunity.id, opportunityInput)
  console.log(`Updated ${updatedOpportunity.id} for ${account.accountId}, and stage ${stage.name}`)
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

export function toOpportunityInput(
  account: OpportunityAccount,
  route: CalendarRoute,
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
    locationId: route.locationId,
    pipelineId: route.pipelineId,
    pipelineStageId,
    contactId,
    name,
    status: 'open',
    assignedTo,
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
