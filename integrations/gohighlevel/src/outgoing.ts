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
  toContactFieldValues as toContactFieldValues,
} from './util.ts'
import {
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  type ContactResponse,
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
  const closer = account.closer
  if (!closer) throw Error(`${account.id} has no closer`)

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const team = await resolveGoHighLevelTeam(client, closer)
  const locationId = team.externalId
  if (!locationId) throw Error(`${team.teamId} has no location ID`)
  const pipelineId = scriptConfig.teamPipelines[team.teamId]
  if (!pipelineId) throw Error(`Missing teamPipelines for ${team.teamId}`)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, locationId)
  const assignedTo = await findAssignedUserId(accessToken, locationId, closer.email)
  const contactInput = toContactInput(account, locationId, scriptConfig, assignedTo)
  let contactResponse: ContactResponse
  if (account.externalLeadId) {
    const existingContact = await getContact(accessToken, account.externalLeadId)
    if (existingContact.locationId !== contactInput.locationId) {
      throw Error(
        `Contact ${account.externalLeadId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
      )
    }

    const { locationId: _locationId, ...contactUpdate } = contactInput
    console.log('Contact update:', contactUpdate)
    contactResponse = await updateContact(accessToken, account.externalLeadId, contactUpdate)
  } else {
    console.log('Upsert Contact:', contactInput)
    contactResponse = await upsertContact(accessToken, contactInput)
  }
  console.log(contactResponse)
  const contact = contactResponse.contact

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

  const opportunityUpdate = { pipelineStageId: stage.id }
  console.log('Opportunity update:', opportunityUpdate)
  const updatedOpportunity = await updateOpportunityStage(accessToken, existingOpportunity.id, opportunityUpdate)
  console.log(updatedOpportunity)
})

function toContactInput(
  account: AccountChangeData,
  locationId: string,
  config: ScriptConfig,
  assignedTo: string | undefined
): GoHighLevelContactInput {
  const customFields = toContactFieldValues(account, config.contactFieldMappings)

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
    customFields,
  }
  return contact
}
