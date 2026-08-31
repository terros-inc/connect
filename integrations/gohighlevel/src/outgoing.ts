import { type AccountWebhook, type AccountWebhookData, type CustomFieldId, wrapConnectHandler } from '@terros-inc/sdk'
import {
  createOpportunity,
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  type GoHighLevelContact,
  type GoHighLevelContactInput,
  type GoHighLevelCustomField,
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

type AccountFieldSource = {
  customFields?: AccountWebhookData['customFields']
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
  const goHighLevelCustomFields = toGoHighLevelCustomFields(account, config.contactFieldMappings)

  const contact: GoHighLevelContactInput = {
    locationId,
    firstName: readTrimmedString(account.homeowner?.firstName),
    lastName: readTrimmedString(account.homeowner?.lastName),
    name: readTrimmedString(account.homeowner?.name),
    email: readTrimmedString(account.homeowner?.email),
    phone: readTrimmedString(account.homeowner?.phone),
    address1: account.location?.line1,
    city: account.location?.locality,
    state: account.location?.countrySubd,
    postalCode: account.location?.postal1,
    assignedTo,
    source: 'Terros',
    customFields: goHighLevelCustomFields,
  }
  return contact
}

function toOpportunityInput(
  account: AccountWebhookData,
  route: { locationId: string; pipelineId: string },
  contactId: string,
  pipelineStageId: string,
  assignedTo: string | undefined
): GoHighLevelOpportunityInput {
  const firstName = readTrimmedString(account.homeowner?.firstName) || ''
  const lastName = readTrimmedString(account.homeowner?.lastName) || ''
  const name =
    `${firstName} ${lastName}`.trim() || readTrimmedString(account.homeowner?.name) || `Terros Account ${account.id}`

  const opportunity: GoHighLevelOpportunityInput = {
    locationId: route.locationId,
    pipelineId: route.pipelineId,
    pipelineStageId,
    contactId,
    name,
    status: 'open',
    assignedTo,
  }
  return opportunity
}

export function toGoHighLevelCustomFields(
  account: AccountFieldSource,
  mappings: Record<string, string>
): GoHighLevelCustomField[] {
  const goHighLevelCustomFields: GoHighLevelCustomField[] = []

  for (const [terrosAccountField, goHighLevelCustomFieldId] of Object.entries(mappings)) {
    const fieldValue = getAccountFieldValue(account, terrosAccountField)
    if (fieldValue === undefined || fieldValue === null) continue

    switch (typeof fieldValue) {
      case 'string':
      case 'number':
      case 'boolean':
        goHighLevelCustomFields.push({ id: goHighLevelCustomFieldId, fieldValue })
        break
      default:
        throw Error(`Cannot send non-primitive Terros field ${terrosAccountField} to a GoHighLevel custom field`)
    }
  }

  return goHighLevelCustomFields
}

function getAccountFieldValue(account: AccountFieldSource, field: string): unknown {
  if (isCustomFieldId(field)) return account.customFields?.[field]

  const accountField = field.startsWith('account.') ? field.slice('account.'.length) : field
  let fieldValue: unknown = account

  for (const key of accountField.split('.')) {
    if (typeof fieldValue !== 'object' || fieldValue === null) return
    fieldValue = Reflect.get(fieldValue, key)
  }

  return fieldValue
}

function isCustomFieldId(field: string): field is CustomFieldId {
  return field.startsWith('CF.')
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  return trimmed || undefined
}
