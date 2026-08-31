// this time can be removed now probably since it's just an apiKey. not entirely sure why it's has it's own type to begin with
export type GoHighLevelConfig = {
  apiKey: string
}

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

const baseUrl = 'https://services.leadconnectorhq.com'

export async function getContact(config: GoHighLevelConfig, contactId: string): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(config, `/contacts/${contactId}`)
  return response.contact
}

export async function upsertContact(
  config: GoHighLevelConfig,
  contact: GoHighLevelContactInput
): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(config, '/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify(contact),
  })
  return response.contact
}

export async function updateContact(
  config: GoHighLevelConfig,
  contactId: string,
  contact: Omit<GoHighLevelContactInput, 'locationId'>
): Promise<GoHighLevelContact> {
  const response = await ghlApi<{ contact: GoHighLevelContact }>(config, `/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(contact),
  })
  return response.contact
}

export async function getPipeline(
  config: GoHighLevelConfig,
  locationId: string,
  pipelineId: string
): Promise<GoHighLevelPipeline> {
  const search = new URLSearchParams({ locationId })
  const response = await ghlApi<{ pipelines: GoHighLevelPipeline[] }>(config, `/opportunities/pipelines?${search}`)
  const pipelines = response.pipelines.filter((pipeline) => pipeline.id === pipelineId)
  // just grabbing the first in the list isn't great, we need a better way to find which one
  const pipeline = pipelines[0]
  if (pipelines.length !== 1 || !pipeline) {
    throw Error(`Expected one GoHighLevel pipeline ${pipelineId} in location ${locationId}, found ${pipelines.length}`)
  }
  return pipeline
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
  config: GoHighLevelConfig,
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
  const response = await ghlApi<{ opportunities: GoHighLevelOpportunity[] }>(config, `/opportunities/search?${search}`)
  if (response.opportunities.length > 1) {
    throw Error(`Multiple GoHighLevel opportunities found for contact ${contactId} in pipeline ${route.pipelineId}`)
  }
  return response.opportunities[0]
}

export async function createOpportunity(
  config: GoHighLevelConfig,
  opportunity: GoHighLevelOpportunityInput
): Promise<GoHighLevelOpportunity> {
  const response = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(config, '/opportunities/', {
    method: 'POST',
    body: JSON.stringify(opportunity),
  })
  return response.opportunity
}

export async function updateOpportunity(
  config: GoHighLevelConfig,
  opportunityId: string,
  opportunity: Pick<GoHighLevelOpportunityInput, 'pipelineId' | 'pipelineStageId' | 'name' | 'status' | 'assignedTo'>
): Promise<GoHighLevelOpportunity> {
  const response = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(config, `/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify(opportunity),
  })
  return response.opportunity
}

async function ghlApi<T>(config: GoHighLevelConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
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
