import { type AccountWebhook, type AccountWebhookData, wrapConnectHandler } from '@terros-inc/sdk'
import {
  createOpportunity,
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  type GoHighLevelContact,
  type GoHighLevelContactInput,
  type GoHighLevelOpportunityInput,
  updateContact,
  updateOpportunity,
  upsertContact,
} from './gohighlevel.ts'
import { resolveStageName, resolveTeamRoute } from './config.ts'

type ScriptConfig = {
  teamLocations: Record<string, string>
  teamPipelines: Record<string, string>
  contactFieldMappings: Record<string, string>
}

export const handler = wrapConnectHandler<AccountWebhook>(async (input, client) => {
  const payload = input.context.payload
  if (payload.action === 'remove') {
    console.log(`Skipping GoHighLevel sync for removed Terros account ${payload.data}`)
    return
  }

  const account = payload.data
  if (!account.teamId) throw Error(`Terros account ${account.id} has no teamId`)
  if (!account.workflowStageName) throw Error(`Terros account ${account.id} has no workflow stage name`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const apiKey = input.context.config.secrets.apiKey
  if (!apiKey) throw Error('Missing GoHighLevel apiKey')

  const route = resolveTeamRoute(scriptConfig, account.teamId)
  const assignedTo = await findAssignedUserId(apiKey, route.locationId, account.owner?.email)
  const contactInput = toContactInput(account, route.locationId, scriptConfig, assignedTo)
  const contact = await syncContact(apiKey, account.externalLeadId, contactInput)

  // actually, looking at it, we looked it up by id, it should always be the same id right? this check should be redundant
  if (account.externalLeadId && account.externalLeadId !== contact.id) {
    throw Error(
      `Terros account ${account.id} stores GoHighLevel contact ${account.externalLeadId}, but GoHighLevel returned ${contact.id}`
    )
  }

  if (!account.externalLeadId) {
    await client.account.update({
      account: {
        accountId: account.id,
        externalLeadId: contact.id,
      },
    })
    console.log(
      `Saved GoHighLevel contact ${contact.id} on Terros account ${account.id} for team ${account.teamId} and location ${route.locationId}`
    )
  }

  const pipeline = await getPipeline(apiKey, route.locationId, route.pipelineId)
  const stageName = resolveStageName(account.workflowStageName)
  const stage = findPipelineStage(pipeline, stageName)
  const existingOpportunity = await findOpportunity(apiKey, route, contact.id)
  const opportunityInput = toOpportunityInput(account, route, contact.id, stage.id, assignedTo)

  if (!existingOpportunity) {
    const createdOpportunity = await createOpportunity(apiKey, opportunityInput)
    console.log(
      `Created GoHighLevel opportunity ${createdOpportunity.id} for Terros account ${account.id}, team ${account.teamId}, location ${route.locationId}, pipeline ${route.pipelineId}, and stage ${stage.name}`
    )
    return
  }

  if (existingOpportunity.pipelineStageId === stage.id) {
    console.log(
      `Skipped GoHighLevel opportunity ${existingOpportunity.id} stage update for Terros account ${account.id}; already at ${stage.name}`
    )
    return
  }

  const updatedOpportunity = await updateOpportunity(apiKey, existingOpportunity.id, opportunityInput)
  console.log(
    `Updated GoHighLevel opportunity ${updatedOpportunity.id} for Terros account ${account.id}, and stage ${stage.name}`
  )
})

async function syncContact(
  apiKey: string,
  contactId: string | undefined,
  contactInput: GoHighLevelContactInput
): Promise<GoHighLevelContact> {
  if (!contactId) return upsertContact(apiKey, contactInput)

  const existingContact = await getContact(apiKey, contactId)
  if (existingContact.locationId !== contactInput.locationId) {
    throw Error(
      `GoHighLevel contact ${contactId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
    )
  }

  const { locationId: _locationId, ...updatedContact } = contactInput
  return updateContact(apiKey, contactId, updatedContact)
}

function toContactInput(
  account: AccountWebhookData,
  locationId: string,
  config: ScriptConfig,
  assignedTo: string | undefined
): GoHighLevelContactInput {
  const customFields = resolveCustomFields(account, config.contactFieldMappings)

  const contact: GoHighLevelContactInput = {
    locationId,
    firstName: readTrimmedString(getObjectValue(account.homeowner || {}, 'firstName')),
    lastName: readTrimmedString(getObjectValue(account.homeowner || {}, 'lastName')),
    name: readTrimmedString(getObjectValue(account.homeowner || {}, 'name')),
    email: readTrimmedString(getObjectValue(account.homeowner || {}, 'email')),
    phone: readTrimmedString(getObjectValue(account.homeowner || {}, 'phone')),
    address1: account.location?.line1,
    city: account.location?.locality,
    state: account.location?.countrySubd,
    postalCode: account.location?.postal1,
    assignedTo,
    source: 'Terros',
    customFields: customFields.length ? customFields : undefined,
  }
  return removeUndefinedValues(contact)
}

function toOpportunityInput(
  account: AccountWebhookData,
  route: { locationId: string; pipelineId: string },
  contactId: string,
  pipelineStageId: string,
  assignedTo: string | undefined
): GoHighLevelOpportunityInput {
  // this is ridiculous for just getting a name. also why is this an array? just `${firstName} ${lastName}` call it a day
  const name =
    [
      readTrimmedString(getObjectValue(account.homeowner || {}, 'firstName')),
      readTrimmedString(getObjectValue(account.homeowner || {}, 'lastName')),
    ]
      .filter(Boolean)
      .join(' ') ||
    readTrimmedString(getObjectValue(account.homeowner || {}, 'name')) ||
    `Terros Account ${account.id}`

  const opportunity: GoHighLevelOpportunityInput = {
    locationId: route.locationId,
    pipelineId: route.pipelineId,
    pipelineStageId,
    contactId,
    name,
    status: 'open',
    assignedTo,
  }
  return removeUndefinedValues(opportunity)
}

// everything from here down needs explaining on what it's doing. it's impossible to read what it's doing and best I can tell it's just fancy useless code
function resolveCustomFields(
  account: AccountWebhookData,
  mappings: Record<string, string>
): { id: string; fieldValue: string | number | boolean }[] {
  return Object.entries(mappings).flatMap(([sourceField, targetFieldId]) => {
    const value = resolveAccountField(account, sourceField)
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return []
    return [{ id: targetFieldId, fieldValue: value }]
  })
}

function resolveAccountField(account: AccountWebhookData, field: string): unknown {
  if (field.startsWith('CF.')) {
    return getObjectValue(account.customFields || {}, field)
  }

  return field.split('.').reduce<unknown>((value, key) => {
    return getObjectValue(value, key)
  }, account)
}

function getObjectValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) throw Error(`Cannot read ${key} from a non-object account field`)
  return Reflect.get(value, key)
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  return trimmed || undefined
}

function removeUndefinedValues<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
