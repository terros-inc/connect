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
  customFields?: { id: string; fieldValue: string | number | boolean }[]
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

type GoHighLevelLocation = {
  id: string
  companyId: string
}

type GoHighLevelUser = {
  id: string
  email?: string
}

const baseUrl = 'https://services.leadconnectorhq.com' // why do we have a base url here? this seems to be company specfic and should be config only in that case

export async function getContact(apiKey: string, contactId: string): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(apiKey, `/contacts/${contactId}`)
  return response.contact
}

export async function upsertContact(apiKey: string, contact: GoHighLevelContactInput): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(apiKey, '/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify(contact),
  })
  return response.contact
}

export async function updateContact(
  apiKey: string,
  contactId: string,
  contact: Omit<GoHighLevelContactInput, 'locationId'>
): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(apiKey, `/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(contact),
  })
  return response.contact
}

export async function getPipeline(
  apiKey: string,
  locationId: string,
  pipelineId: string
): Promise<GoHighLevelPipeline> {
  const search = new URLSearchParams({ locationId })
  const response = await ghlApi<{ pipelines: GoHighLevelPipeline[] }>(apiKey, `/opportunities/pipelines?${search}`)
  const pipeline = response.pipelines.find((candidate) => candidate.id === pipelineId)
  if (!pipeline) throw Error(`GoHighLevel pipeline ${pipelineId} was not found in location ${locationId}`)
  return pipeline
}

export async function findAssignedUserId(
  apiKey: string,
  locationId: string,
  ownerEmail: string | undefined
): Promise<string | undefined> {
  if (!ownerEmail) return

  const locationResponse = await ghlApi<{ location: GoHighLevelLocation }>(apiKey, `/locations/${locationId}`)
  const search = new URLSearchParams({
    companyId: locationResponse.location.companyId,
    locationId,
    query: ownerEmail,
    limit: '2',
  })
  const response = await ghlApi<{ users: GoHighLevelUser[] }>(apiKey, `/users/search?${search}`)
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

export async function findOpportunity(
  apiKey: string,
  route: { locationId: string; pipelineId: string },
  contactId: string
): Promise<GoHighLevelOpportunity | undefined> {
  const search = new URLSearchParams({
    locationId: route.locationId,
    pipelineId: route.pipelineId,
    contactId,
    status: 'all',
    limit: '2',
  })
  const response = await ghlApi<{ opportunities: GoHighLevelOpportunity[] }>(apiKey, `/opportunities/search?${search}`)
  if (response.opportunities.length > 1) {
    throw Error(`Multiple GoHighLevel opportunities found for contact ${contactId} in pipeline ${route.pipelineId}`)
  }
  return response.opportunities[0]
}

export async function createOpportunity(
  apiKey: string,
  opportunity: GoHighLevelOpportunityInput
): Promise<GoHighLevelOpportunity> {
  const response = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(apiKey, '/opportunities/', {
    method: 'POST',
    body: JSON.stringify(opportunity),
  })
  return response.opportunity
}

export async function updateOpportunity(
  apiKey: string,
  opportunityId: string,
  opportunity: Pick<GoHighLevelOpportunityInput, 'pipelineId' | 'pipelineStageId' | 'name' | 'status' | 'assignedTo'>
): Promise<GoHighLevelOpportunity> {
  const response = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(apiKey, `/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify(opportunity),
  })
  return response.opportunity
}

async function ghlApi<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Version: 'v3',
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000)
    throw Error(`GoHighLevel request failed: ${response.status} ${response.statusText} ${body}`)
  }

  return response.json() as Promise<T>
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase()
}
