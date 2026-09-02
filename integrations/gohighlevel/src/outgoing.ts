import {
  type AccountId,
  type CustomFieldMap,
  type SmallAddress,
  type TeamId,
  type TinyResidentData,
  wrapConnectHandler,
} from '@terros-inc/sdk'
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
import { resolveGoHighLevelStageName, resolveTeamRoute } from './config.ts'

type ScriptConfig = {
  teamPipelines: Record<string, string>
  stageMappings?: Record<string, string>
  contactFieldMappings?: Record<string, string>
}

type Secrets = {
  privateIntegrationTokens: Record<string, string>
}

type AccountChangeData = {
  id: AccountId
  workflowState?: {
    stageName?: string
  }
  owner?: {
    email?: string
    teamIds?: TeamId[]
  }
  address?: SmallAddress
  resident?: TinyResidentData
  externalLeadId?: string
  customFieldMap?: CustomFieldMap
}

type AccountChangeWebhook =
  | {
      entity: 'Account'
      action: 'add' | 'update'
      data: AccountChangeData
    }
  | {
      entity: 'Account'
      action: 'remove'
      data: { id: AccountId }
    }

export const handler = wrapConnectHandler<AccountChangeWebhook>(async (input, client) => {
  const payload = input.context.payload
  console.log(`Received account ${payload.action} for ${payload.data.id}`)

  if (payload.action === 'remove') {
    console.log(`Skipping sync for removed Terros account ${payload.data.id}`)
    return
  }

  const teamId = payload.data.owner?.teamIds?.[0]
  if (!teamId) throw Error(`Terros account ${payload.data.id} owner has no teamId`)
  const account = payload.data
  if (!account.workflowState?.stageName) throw Error(`Terros account ${account.id} has no workflow stage name`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const { team } = await client.team.get({ teamId })
  const route = resolveTeamRoute(scriptConfig, team)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, route.locationId)
  const assignedTo = await findAssignedUserId(accessToken, route.locationId, account.owner?.email)
  const contactInput = toContactInput(account, route.locationId, scriptConfig, assignedTo)
  const contact = await syncContact(accessToken, account.externalLeadId, contactInput)

  if (!account.externalLeadId) {
    const { account: updatedAccount } = await client.account.update({
      account: {
        accountId: account.id,
        externalLeadId: contact.id,
      },
    })
    if (updatedAccount.externalLeadId !== contact.id) {
      throw Error(`Account update did not save contact ${contact.id} as externalLeadId on account ${account.id}`)
    }
    console.log(`Saved contact ${contact.id} as externalLeadId on account ${account.id}`)
  }

  const pipeline = await getPipeline(accessToken, route.locationId, route.pipelineId)
  const stageName = resolveGoHighLevelStageName(account.workflowState.stageName, scriptConfig.stageMappings)
  const stage = findPipelineStage(pipeline, stageName)
  console.log(`Resolved ${account.workflowState.stageName} to stage ${stage.name} (${stage.id}) in ${pipeline.id}`)
  const existingOpportunity = await findOpportunity(accessToken, route, contact.id)
  const opportunityInput = toOpportunityInput(account, route, contact.id, stage.id, assignedTo)

  if (!existingOpportunity) {
    const createdOpportunity = await createOpportunity(accessToken, opportunityInput)
    console.log(`Created opportunity ${createdOpportunity.id} for Terros account ${account.id}`)
    return
  }

  if (!opportunityNeedsUpdate(existingOpportunity, opportunityInput)) {
    console.log(`Skipped unchanged opportunity ${existingOpportunity.id} for Terros account ${account.id}`)
    return
  }

  const updatedOpportunity = await updateOpportunity(accessToken, existingOpportunity.id, opportunityInput)
  console.log(`Updated opportunity ${updatedOpportunity.id} for ${account.id}, and stage ${stage.name}`)
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
      `Contact ${contactId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
    )
  }

  const { locationId: _locationId, ...updatedContact } = contactInput
  return updateContact(accessToken, contactId, updatedContact)
}

function toContactInput(
  account: AccountChangeData,
  locationId: string,
  config: ScriptConfig,
  assignedTo: string | undefined
): GoHighLevelContactInput {
  const goHighLevelCustomFields = toGoHighLevelCustomFields(account, config.contactFieldMappings)

  const contact: GoHighLevelContactInput = {
    locationId,
    firstName: readTrimmedString(account.resident?.firstName),
    lastName: readTrimmedString(account.resident?.lastName),
    name: readTrimmedString(account.resident?.name),
    email: readTrimmedString(account.resident?.email),
    phone: readTrimmedString(account.resident?.phone),
    address1: account.address?.line1,
    city: account.address?.locality,
    state: account.address?.countrySubd,
    postalCode: account.address?.postal1,
    assignedTo,
    source: 'Terros',
    customFields: goHighLevelCustomFields,
  }
  return contact
}

function toOpportunityInput(
  account: AccountChangeData,
  route: { locationId: string; pipelineId: string },
  contactId: string,
  pipelineStageId: string,
  assignedTo: string | undefined
): GoHighLevelOpportunityInput {
  const firstName = readTrimmedString(account.resident?.firstName) || ''
  const lastName = readTrimmedString(account.resident?.lastName) || ''
  const name =
    `${firstName} ${lastName}`.trim() || readTrimmedString(account.resident?.name) || `Terros Account ${account.id}`

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
