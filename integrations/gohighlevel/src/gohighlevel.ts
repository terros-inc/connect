import { ghlApi, normalizeName, type GoHighLevelCustomField } from './util.ts'

export type GoHighLevelContact = {
  id: string
  locationId: string
}

export type GoHighLevelContactInput = {
  locationId: string
  firstName?: string
  lastName?: string
  name?: string
  email?: string
  phone?: string
  address1?: string
  city?: string
  state?: string
  postalCode?: string
  assignedTo?: string
  source?: string
  customFields?: GoHighLevelCustomField[]
}

export type GoHighLevelPipelineStage = {
  id: string
  name: string
}

export type GoHighLevelPipeline = {
  id: string
  locationId: string
  stages: GoHighLevelPipelineStage[]
}

export type GoHighLevelOpportunity = {
  id: string
  contactId: string
  locationId: string
  pipelineId: string
  pipelineStageId?: string
  name?: string
  assignedTo?: string
}

export type GoHighLevelOpportunityInput = {
  locationId: string
  pipelineId: string
  pipelineStageId: string
  contactId: string
  name: string
  status: 'open'
  assignedTo?: string
}

export type GoHighLevelAppointment = {
  id: string
  calendarId: string
  locationId: string
  contactId: string
}

export type GoHighLevelAppointmentInput = {
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

export type GoHighLevelAppointmentUpdate = Partial<
  Omit<GoHighLevelAppointmentInput, 'locationId' | 'contactId' | 'appointmentStatus'>
> & {
  appointmentStatus?: 'confirmed' | 'cancelled'
}

type GoHighLevelLocation = {
  id: string
  companyId: string
}

type GoHighLevelUser = {
  id: string
  email?: string
}

export async function getContact(accessToken: string, contactId: string): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, `/contacts/${contactId}`)
  return response.contact
}

export async function upsertContact(
  accessToken: string,
  contact: GoHighLevelContactInput
): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, '/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify(contact),
  })
  return response.contact
}

export async function updateContact(
  accessToken: string,
  contactId: string,
  contact: Omit<GoHighLevelContactInput, 'locationId'>
): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, `/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(contact),
  })
  console.log(`Updated contact ${contactId}`)
  return response.contact
}

export async function getPipeline(
  accessToken: string,
  locationId: string,
  pipelineId: string
): Promise<GoHighLevelPipeline> {
  const search = new URLSearchParams({ locationId })
  const response = await ghlApi<{ pipelines: GoHighLevelPipeline[] }>(accessToken, `/opportunities/pipelines?${search}`)
  const pipeline = response.pipelines.find((candidate) => candidate.id === pipelineId)
  if (!pipeline) throw Error(`GoHighLevel pipeline ${pipelineId} was not found in location ${locationId}`)
  return pipeline
}

export async function findAssignedUserId(
  accessToken: string,
  locationId: string,
  ownerEmail: string | undefined
): Promise<string | undefined> {
  if (!ownerEmail) return

  const locationResponse = await ghlApi<{ location: GoHighLevelLocation }>(accessToken, `/locations/${locationId}`)
  const search = new URLSearchParams({
    companyId: locationResponse.location.companyId,
    locationId,
    query: ownerEmail,
    limit: '2',
  })
  const response = await ghlApi<{ users: GoHighLevelUser[] }>(accessToken, `/users/search?${search}`)
  const normalizedOwnerEmail = normalizeName(ownerEmail)
  const matchingUsers = response.users.filter(
    (user) => user.email && normalizeName(user.email) === normalizedOwnerEmail
  )

  if (matchingUsers.length > 1) {
    throw Error(`Multiple GoHighLevel users matched the Terros account owner in location ${locationId}`)
  }

  const matchingUser = matchingUsers[0]
  if (!matchingUser) {
    console.log(`No GoHighLevel user matched the Terros account owner in location ${locationId}`)
    return
  }

  return matchingUser.id
}

export function findPipelineStage(pipeline: GoHighLevelPipeline, stageName: string): GoHighLevelPipelineStage {
  const normalizedStageName = normalizeName(stageName)
  const stages = pipeline.stages.filter((stage) => normalizeName(stage.name) === normalizedStageName)
  const stage = stages[0]
  if (stages.length !== 1 || !stage) {
    throw Error(
      `Expected one stage named "${stageName}" in GoHighLevel pipeline ${pipeline.id}, found ${stages.length}`
    )
  }
  return stage
}

export function getPipelineStageName(pipeline: GoHighLevelPipeline, stageId: string): string {
  const stages = pipeline.stages.filter((stage) => stage.id === stageId)
  const stage = stages[0]
  if (stages.length !== 1 || !stage) {
    throw Error(`Expected one stage ${stageId} in GoHighLevel pipeline ${pipeline.id}, found ${stages.length}`)
  }
  return stage.name
}

export function opportunityNeedsUpdate(
  opportunity: GoHighLevelOpportunity,
  input: Pick<GoHighLevelOpportunityInput, 'pipelineStageId' | 'name' | 'assignedTo'>
): boolean {
  if (opportunity.pipelineStageId !== input.pipelineStageId) return true
  if (opportunity.name !== input.name) return true
  return input.assignedTo !== undefined && opportunity.assignedTo !== input.assignedTo
}

export async function findOpportunity(
  accessToken: string,
  route: { locationId: string; pipelineId: string },
  contactId: string
): Promise<GoHighLevelOpportunity | undefined> {
  const search = new URLSearchParams({
    location_id: route.locationId,
    pipeline_id: route.pipelineId,
    contact_id: contactId,
    status: 'all',
    limit: '2',
  })
  const response = await ghlApi<{ opportunities: GoHighLevelOpportunity[] }>(
    accessToken,
    `/opportunities/search?${search}`
  )
  if (response.opportunities.length > 1) {
    throw Error(`Multiple GoHighLevel opportunities found for contact ${contactId} in pipeline ${route.pipelineId}`)
  }
  return response.opportunities[0]
}

export async function createOpportunity(
  accessToken: string,
  opportunity: GoHighLevelOpportunityInput
): Promise<GoHighLevelOpportunity> {
  const response = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, '/opportunities/', {
    method: 'POST',
    body: JSON.stringify(opportunity),
  })
  return response.opportunity
}

export async function updateOpportunity(
  accessToken: string,
  opportunityId: string,
  opportunity: Pick<GoHighLevelOpportunityInput, 'pipelineId' | 'pipelineStageId' | 'name' | 'status' | 'assignedTo'>
): Promise<GoHighLevelOpportunity> {
  const response = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(
    accessToken,
    `/opportunities/${opportunityId}`,
    {
      method: 'PUT',
      body: JSON.stringify(opportunity),
    }
  )
  return response.opportunity
}

export async function createAppointment(
  accessToken: string,
  appointment: GoHighLevelAppointmentInput
): Promise<GoHighLevelAppointment> {
  return await ghlApi<GoHighLevelAppointment>(accessToken, '/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify(appointment),
  })
}

export async function updateAppointment(
  accessToken: string,
  appointmentId: string,
  appointment: GoHighLevelAppointmentUpdate
): Promise<GoHighLevelAppointment> {
  return await ghlApi<GoHighLevelAppointment>(accessToken, `/calendars/events/appointments/${appointmentId}`, {
    method: 'PUT',
    body: JSON.stringify(appointment),
  })
}
