import { type AccountData, type CustomFieldMap, type SmallAddress, type TinyResidentData } from '@terros-inc/sdk'
import { ghlApi, isEmpty, normalizeText, readString, toContactFields, type GoHighLevelCustomField } from './util.ts'

export type GoHighLevelUser = {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  email?: string
}

type GoHighLevelLocation = {
  id: string
  companyId: string
}

export async function listUsers(
  accessToken: string,
  locationId: string,
  userIds: string[]
): Promise<GoHighLevelUser[]> {
  if (isEmpty(userIds)) return []

  const locationResponse = await ghlApi<{ location: GoHighLevelLocation }>(accessToken, `/locations/${locationId}`)
  const search = new URLSearchParams({
    companyId: locationResponse.location.companyId,
    locationId,
    ids: userIds.join(','),
    limit: String(userIds.length),
  })
  const response = await ghlApi<{ users: GoHighLevelUser[] }>(accessToken, `/users/search?${search}`)
  return response.users
}

type ContactAccount = {
  address?: SmallAddress
  resident?: TinyResidentData
  customFieldMap?: CustomFieldMap
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

export function toContact(
  account: ContactAccount,
  locationId: string,
  contactFieldMappings: Record<string, string> | undefined,
  assignedTo: string | undefined
): GoHighLevelContactInput {
  return {
    locationId,
    firstName: readString(account.resident?.firstName),
    lastName: readString(account.resident?.lastName),
    name: readString(account.resident?.name),
    email: readString(account.resident?.email),
    phone: readString(account.resident?.phone),
    address1: account.address?.line1,
    city: account.address?.locality,
    state: account.address?.countrySubd,
    postalCode: account.address?.postal1,
    assignedTo,
    source: 'Terros',
    customFields: toContactFields(account, contactFieldMappings),
  }
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

export async function findUserId(
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
  const normalizedOwnerEmail = normalizeText(ownerEmail)
  const matchingUsers = response.users.filter(
    (user) => user.email && normalizeText(user.email) === normalizedOwnerEmail
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

export function findStage(pipeline: GoHighLevelPipeline, stageName: string): GoHighLevelPipelineStage {
  const normalizedStageName = normalizeText(stageName)
  const stages = pipeline.stages.filter((stage) => normalizeText(stage.name) === normalizedStageName)
  const stage = stages[0]
  if (stages.length !== 1 || !stage) {
    throw Error(
      `Expected one stage named "${stageName}" in GoHighLevel pipeline ${pipeline.id}, found ${stages.length}`
    )
  }
  return stage
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

export function needsUpdate(
  opportunity: GoHighLevelOpportunity,
  input: Pick<GoHighLevelOpportunityInput, 'pipelineStageId' | 'name' | 'assignedTo'>
): boolean {
  if (opportunity.pipelineStageId !== input.pipelineStageId) return true
  if (opportunity.name !== input.name) return true
  return input.assignedTo !== undefined && opportunity.assignedTo !== input.assignedTo
}

type OpportunityAccount = Pick<AccountData, 'accountId' | 'resident'>

export function toOpportunity(
  account: OpportunityAccount,
  route: { locationId: string; pipelineId: string },
  contactId: string,
  pipelineStageId: string,
  assignedTo: string | undefined
): GoHighLevelOpportunityInput {
  const firstName = readString(account.resident?.firstName) || ''
  const lastName = readString(account.resident?.lastName) || ''
  const name =
    `${firstName} ${lastName}`.trim() || readString(account.resident?.name) || `Terros Account ${account.accountId}`

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
