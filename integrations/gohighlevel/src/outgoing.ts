import { type AccountWebhook, type AccountWebhookData, wrapConnectHandler } from '@terros-inc/sdk'
import { getPrivateIntegrationToken, readTrimmedString, toGoHighLevelCustomFields } from './util.ts'
import {
  createOpportunity,
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  opportunityNeedsUpdate,
  type GoHighLevelContact,
  type GoHighLevelContactInput,
  type GoHighLevelOpportunityInput,
  updateContact,
  updateOpportunity,
  upsertContact,
} from './gohighlevel.ts'
import { resolveStageName, resolveTeamRoute } from './config.ts'

type ScriptConfig = {
  teamPipelines: Record<string, string>
  contactFieldMappings: Record<string, string>
}

type Secrets = {
  privateIntegrationTokens: Record<string, string>
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
  const { team } = await client.team.get({ teamId: account.teamId })
  const route = resolveTeamRoute(scriptConfig, team)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, route.locationId)
  const assignedTo = await findAssignedUserId(accessToken, route.locationId, account.owner?.email)
  const contactInput = toContactInput(account, route.locationId, scriptConfig, assignedTo)
  const contact = await syncContact(accessToken, account.externalLeadId, contactInput)

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

  const pipeline = await getPipeline(accessToken, route.locationId, route.pipelineId)
  const stageName = resolveStageName(account.workflowStageName)
  const stage = findPipelineStage(pipeline, stageName)
  const existingOpportunity = await findOpportunity(accessToken, route, contact.id)
  const opportunityInput = toOpportunityInput(account, route, contact.id, stage.id, assignedTo)

  if (!existingOpportunity) {
    const createdOpportunity = await createOpportunity(accessToken, opportunityInput)
    console.log(
      `Created GoHighLevel opportunity ${createdOpportunity.id} for Terros account ${account.id}, team ${account.teamId}, location ${route.locationId}, pipeline ${route.pipelineId}, and stage ${stage.name}`
    )
    return
  }

  if (!opportunityNeedsUpdate(existingOpportunity, opportunityInput)) {
    console.log(`Skipped unchanged GoHighLevel opportunity ${existingOpportunity.id} for Terros account ${account.id}`)
    return
  }

  const updatedOpportunity = await updateOpportunity(accessToken, existingOpportunity.id, opportunityInput)
  console.log(
    `Updated GoHighLevel opportunity ${updatedOpportunity.id} for Terros account ${account.id}, and stage ${stage.name}`
  )
})

async function syncContact(
  accessToken: string,
  contactId: string | undefined,
  contactInput: GoHighLevelContactInput
): Promise<GoHighLevelContact> {
  if (!contactId) return upsertContact(accessToken, contactInput)

  const existingContact = await getContact(accessToken, contactId)
  if (existingContact.locationId !== contactInput.locationId) {
    throw Error(
      `GoHighLevel contact ${contactId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
    )
  }

  const { locationId: _locationId, ...updatedContact } = contactInput
  return updateContact(accessToken, contactId, updatedContact)
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
