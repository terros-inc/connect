import { type AccountWebhook, type AccountWebhookData, wrapConnectHandler } from '@terros-inc/sdk'
import {
  createOpportunity,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  type GoHighLevelConfig,
  type GoHighLevelContact,
  type GoHighLevelContactInput,
  type GoHighLevelOpportunityInput,
  updateContact,
  updateOpportunity,
  upsertContact,
} from './gohighlevel.ts'
import { parseScriptConfig, resolveStageName, resolveTeamRoute } from './config.ts'

export const handler = wrapConnectHandler<AccountWebhook>(async (input, client) => {
  const payload = input.context.payload
  if (payload.action === 'remove') {
    console.log(`Skipping GoHighLevel sync for removed Terros account ${payload.data}`)
    return
  }

  const account = payload.data
  if (!account.teamId) throw Error(`Terros account ${account.id} has no teamId`)
  if (!account.workflowStageName) throw Error(`Terros account ${account.id} has no workflow stage name`)

  const scriptConfig = parseScriptConfig(input.context.config.scriptConfig)
  const apiKey = input.context.config.secrets.apiKey
  if (!apiKey) throw Error('Missing GoHighLevel apiKey')

  const ghlConfig: GoHighLevelConfig = { apiKey }
  const route = resolveTeamRoute(scriptConfig, account.teamId)
  const contactInput = toContactInput(account, route.locationId, scriptConfig)
  const contact = await syncContact(ghlConfig, account.externalLeadId, contactInput)

  // if the externalLeadId is different then we probably shouldn't update it. I also believe that we use sourceId as well, as long as we're being consistent it shouldn't matter?
  if (account.externalLeadId !== contact.id) {
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

  const pipeline = await getPipeline(ghlConfig, route.locationId, route.pipelineId)
  const stageName = resolveStageName(account.workflowStageName)
  const stage = findPipelineStage(pipeline, stageName)
  const existingOpportunity = await findOpportunity(ghlConfig, route, contact.id)
  // I don't think we want to force the installer to map every user to every GHL user, this is unscalable and is better served with team id/looking up the user
  const assignedTo = account.ownerId ? scriptConfig.userMappings[account.ownerId] : undefined
  const opportunityInput = toOpportunityInput(account, route, contact.id, stage.id, assignedTo)

  if (!existingOpportunity) {
    const createdOpportunity = await createOpportunity(ghlConfig, opportunityInput)
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

  const updatedOpportunity = await updateOpportunity(ghlConfig, existingOpportunity.id, opportunityInput)
  console.log(
    `Updated GoHighLevel opportunity ${updatedOpportunity.id} for Terros account ${account.id}, and stage ${stage.name}`
  )
})

async function syncContact(
  config: GoHighLevelConfig,
  contactId: string | undefined,
  contactInput: GoHighLevelContactInput
): Promise<GoHighLevelContact> {
  if (!contactId) return upsertContact(config, contactInput)

  const existingContact = await getContact(config, contactId)
  // pretty sure location id is a terros thing? we can't expect them to have the same location id that we do. have you looked at the GHL docs to make sure that everything we're calling is correct?
  if (existingContact.locationId !== contactInput.locationId) {
    throw Error(
      `GoHighLevel contact ${contactId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
    )
  }

  const { locationId: _locationId, ...updatedContact } = contactInput
  return updateContact(config, contactId, updatedContact)
}

function toContactInput(
  account: AccountWebhookData,
  locationId: string,
  config: ReturnType<typeof parseScriptConfig>
): GoHighLevelContactInput {
  const customFields = resolveCustomFields(account, config.contactFieldMappings)
  const assignedTo = account.ownerId ? config.userMappings[account.ownerId] : undefined

  // I refactored this a bit and I'm still not happy with constructing the object being passed into removeUndefinedValues inline
  const contact = removeUndefinedValues({
    locationId,
    firstName: toString(getObjectValue(account.homeowner, 'firstName')),
    lastName: toString(getObjectValue(account.homeowner, 'lastName')),
    name: toString(getObjectValue(account.homeowner, 'name')),
    email: toString(getObjectValue(account.homeowner, 'email')),
    phone: toString(getObjectValue(account.homeowner, 'phone')),
    address1: account.location?.line1,
    city: account.location?.locality,
    state: account.location?.countrySubd,
    postalCode: account.location?.postal1,
    assignedTo,
    source: 'Terros',
    customFields: customFields.length ? customFields : undefined,
  })
  return contact
}

function toOpportunityInput(
  account: AccountWebhookData,
  route: { locationId: string; pipelineId: string },
  contactId: string,
  pipelineStageId: string,
  assignedTo: string | undefined
): GoHighLevelOpportunityInput {
  const name =
    [toString(getObjectValue(account.homeowner, 'firstName')), toString(getObjectValue(account.homeowner, 'lastName'))]
      .filter(Boolean)
      .join(' ') ||
    toString(getObjectValue(account.homeowner, 'name')) ||
    `Terros Account ${account.id}`

  // same as with above, don't like the inlined creation of the object. probably best to create the object then return removeUndefinedValues(obj)
  return removeUndefinedValues({
    locationId: route.locationId,
    pipelineId: route.pipelineId,
    pipelineStageId,
    contactId,
    name,
    status: 'open',
    assignedTo,
  })
}

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
    return getObjectValue(account.customFields, field)
  }

  // why are we replacing parts of the string? not entirely sure what the purpose of this entire function is tbh
  const normalizedField = field.replace(/^(account|payload|data)\./, '')
  return normalizedField.split('.').reduce<unknown>((value, key) => {
    return getObjectValue(value, key)
  }, account)
}

// not sure I like this function, it's better to assume it's an object and accept the error that would rightfully be thrown when it isn't
function getObjectValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1]
}

// don't call it toString if it's not making anything a string. make it part of a more generic removeUndefined if it's going to just be doing this
function toString(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  return trimmed || undefined
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
