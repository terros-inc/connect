import {
  type AccountId,
  type CustomFieldMap,
  type SmallAddress,
  type TinyResidentData,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import {
  createOpportunity,
  findAssignedUserId,
  findOpportunity,
  findPipelineStage,
  getContact,
  getPipeline,
  type ContactResponse,
  toContactInput,
  toOpportunityInput,
  updateContact,
  updateOpportunityStage,
  upsertContact,
} from './gohighlevel.ts'
import { resolveGoHighLevelStageName } from './config.ts'

type ScriptConfig = {
  locationId: string
  pipelineId: string
  stageMappings?: Record<string, string>
  contactFieldMappings?: Record<string, string>
}

type Secrets = {
  privateIntegrationToken: string
}

type AccountChangeData = {
  id: AccountId
  workflowState?: {
    stageName?: string
  }
  closer?: {
    email?: string
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
  const { locationId, pipelineId } = scriptConfig
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = secrets.privateIntegrationToken
  const assignedTo = await findAssignedUserId(accessToken, locationId, closer.email)
  const contactInput = toContactInput(account, locationId, scriptConfig.contactFieldMappings, assignedTo)
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
  const workflowStageName = account.workflowState?.stageName
  if (!workflowStageName) throw Error(`${account.id} has no workflow stage name`)
  const pipeline = await getPipeline(accessToken, locationId, pipelineId)
  const stageName = resolveGoHighLevelStageName(workflowStageName, scriptConfig.stageMappings)
  const stage = findPipelineStage(pipeline, stageName)
  const opportunityInput = toOpportunityInput(
    { accountId: account.id, resident: account.resident },
    route,
    contact.id,
    stage.id,
    assignedTo
  )

  if (!existingOpportunity) {
    const createdOpportunity = await createOpportunity(accessToken, opportunityInput)
    console.log('Created opportunity:', createdOpportunity)
    return
  }

  if (existingOpportunity.pipelineStageId === stage.id) {
    return
  }

  const opportunityUpdate = { pipelineStageId: stage.id }
  console.log('Opportunity update:', opportunityUpdate)
  const updatedOpportunity = await updateOpportunityStage(accessToken, existingOpportunity.id, opportunityUpdate)
  console.log(updatedOpportunity)
})
