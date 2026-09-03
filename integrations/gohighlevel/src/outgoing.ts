import {
  type AccountId,
  type CustomFieldMap,
  type SmallAddress,
  type TeamId,
  type TinyResidentData,
  type UserId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import {
  getPrivateIntegrationToken,
  readTrimmedString,
  resolveGoHighLevelTeam,
  toGoHighLevelContactFieldValues,
} from './util.ts'
import {
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  type GoHighLevelContact,
  type GoHighLevelContactInput,
  updateContact,
  updateOpportunityStage,
  upsertContact,
} from './gohighlevel.ts'
import { resolveGoHighLevelStageName } from './config.ts'

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
    userId?: UserId
  }
  closer?: {
    email?: string
    teamIds?: TeamId[]
    userId?: UserId
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

  const account = payload.data
  const assignedTerrosUser = account.closer ?? account.owner
  if (!assignedTerrosUser) throw Error(`${account.id} has no closer or owner`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const team = await resolveGoHighLevelTeam(client, assignedTerrosUser)
  const locationId = team.externalId
  if (!locationId) throw Error(`${team.teamId} has no location ID`)
  const pipelineId = scriptConfig.teamPipelines[team.teamId]
  if (!pipelineId) throw Error(`Missing teamPipelines for ${team.teamId}`)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, locationId)
  const assignedTo = await findAssignedUserId(accessToken, locationId, assignedTerrosUser.email)
  const contactInput = toContactInput(account, locationId, scriptConfig, assignedTo)
  const contact = await syncContact(accessToken, account.externalLeadId, contactInput)

  if (!account.externalLeadId) {
    const { account: updatedAccount } = await client.account.upsert({
      requestType: 'update',
      account: {
        accountId: account.id,
        externalLeadId: contact.id,
      },
    })
    if (updatedAccount?.externalLeadId !== contact.id) {
      throw Error(`Failed to save contact ${contact.id} to ${account.id}`)
    }
    console.log(`Saved contact ${contact.id} to ${account.id}`)
  }

  const route = { locationId, pipelineId }
  const existingOpportunity = await findOpportunity(accessToken, route, contact.id)
  if (!existingOpportunity) return

  const workflowStageName = account.workflowState?.stageName
  if (!workflowStageName) throw Error(`${account.id} has no workflow stage name`)
  const pipeline = await getPipeline(accessToken, locationId, pipelineId)
  const stageName = resolveGoHighLevelStageName(workflowStageName, scriptConfig.stageMappings)
  const stage = findPipelineStage(pipeline, stageName)
  if (existingOpportunity.pipelineStageId === stage.id) {
    console.log(`Skipped unchanged opportunity stage ${stage.name} for ${account.id}`)
    return
  }

  const updatedOpportunity = await updateOpportunityStage(accessToken, existingOpportunity.id, stage.id)
  console.log(`Updated ${updatedOpportunity.id} to stage ${stage.name}`)
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
  const mappedFields = toGoHighLevelContactFieldValues(account, config.contactFieldMappings)

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
    ...mappedFields.standardFields,
    customFields: mappedFields.customFields,
  }
  return contact
}
