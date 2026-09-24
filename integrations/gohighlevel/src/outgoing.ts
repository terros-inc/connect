import {
  type AccountId,
  type AccountNote,
  type CustomFieldMap,
  type SmallAddress,
  type TinyResidentData,
  type UserId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { ghlApi, isNotEmpty } from './util.ts'
import { getChanges, getIncomingUserIds, getMissingUserIds, getUserInput, type GoHighLevelNote } from './notes.ts'
import {
  findOpportunity,
  findStage,
  findUserId,
  getPipeline,
  listUsers,
  toContact,
  toOpportunity,
  type GoHighLevelOpportunity,
} from './gohighlevel.ts'
import { toGhlStage } from './config.ts'

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
  notes?: AccountNote[]
  closerId?: UserId
  ownerId?: UserId
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

type GoHighLevelContact = {
  id: string
  locationId: string
}

type ContactResponse = {
  contact: GoHighLevelContact
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
  if (!closer) {
    console.log(account)
    throw Error(`${account.id} has no closer`)
  }

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const { locationId, pipelineId } = scriptConfig
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = secrets.privateIntegrationToken
  const assignedTo = await findUserId(accessToken, locationId, closer.email)
  const contactInput = toContact(account, locationId, scriptConfig.contactFieldMappings, assignedTo)
  let contactResponse: ContactResponse
  if (account.externalLeadId) {
    const { contact: existingContact } = await ghlApi<ContactResponse>(
      accessToken,
      `/contacts/${account.externalLeadId}`
    )
    if (existingContact.locationId !== contactInput.locationId) {
      throw Error(
        `Contact ${account.externalLeadId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
      )
    }

    const { locationId: _locationId, ...contactUpdate } = contactInput
    console.log('Contact update:', contactUpdate)
    contactResponse = await ghlApi<ContactResponse>(accessToken, `/contacts/${account.externalLeadId}`, {
      method: 'PUT',
      body: JSON.stringify(contactUpdate),
    })
  } else {
    console.log('Upsert Contact:', contactInput)
    contactResponse = await ghlApi<ContactResponse>(accessToken, '/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify(contactInput),
    })
  }
  console.log(contactResponse)
  const contact = contactResponse.contact

  const { notes: goHighLevelNotes } = await ghlApi<{ notes: GoHighLevelNote[] }>(
    accessToken,
    `/contacts/${contact.id}/notes`
  )
  const terrosUserIds = getMissingUserIds({ notes: account.notes }, goHighLevelNotes)
  const goHighLevelUserIds = getIncomingUserIds({ notes: account.notes }, goHighLevelNotes)
  const userInput = getUserInput(terrosUserIds, goHighLevelUserIds)
  const [userResponse, goHighLevelUsers] = await Promise.all([
    userInput ? client.user.list(userInput) : undefined,
    listUsers(accessToken, locationId, goHighLevelUserIds),
  ])
  const noteChanges = getChanges(
    {
      notes: account.notes,
      closerId: account.closerId,
      ownerId: account.ownerId,
    },
    goHighLevelNotes,
    userResponse?.users ?? [],
    goHighLevelUsers
  )
  await Promise.all(
    noteChanges.goHighLevelNotes.map((note) =>
      ghlApi<{ note: GoHighLevelNote }>(accessToken, `/contacts/${contact.id}/notes`, {
        method: 'POST',
        body: JSON.stringify(note),
      })
    )
  )

  const shouldSaveExternalLeadId = !account.externalLeadId
  if (shouldSaveExternalLeadId || isNotEmpty(noteChanges.terrosNotes)) {
    const { account: updatedAccount } = await client.account.upsert({
      requestType: 'update',
      account: {
        accountId: account.id,
        ...(shouldSaveExternalLeadId ? { externalLeadId: contact.id } : {}),
        ...(isNotEmpty(noteChanges.terrosNotes) ? { notes: noteChanges.terrosNotes } : {}),
      },
    })
    if (shouldSaveExternalLeadId && updatedAccount?.externalLeadId !== contact.id) {
      throw Error(`Failed to save contact ${contact.id} to ${account.id}`)
    }
    console.log(`Saved GoHighLevel updates to ${account.id}`)
  }

  const route = { locationId, pipelineId }
  const existingOpportunity = await findOpportunity(accessToken, route, contact.id)
  const workflowStageName = account.workflowState?.stageName
  if (!workflowStageName) {
    console.log(account)
    throw Error(`${account.id} has no workflow stage name`)
  }
  const pipeline = await getPipeline(accessToken, locationId, pipelineId)
  const stageName = toGhlStage(workflowStageName, scriptConfig.stageMappings)
  const stage = findStage(pipeline, stageName)
  const opportunityInput = toOpportunity(
    { accountId: account.id, resident: account.resident },
    route,
    contact.id,
    stage.id,
    assignedTo
  )

  if (!existingOpportunity) {
    const createdOpportunity = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, '/opportunities/', {
      method: 'POST',
      body: JSON.stringify(opportunityInput),
    })
    console.log('Created opportunity:', createdOpportunity)
    return
  }

  if (existingOpportunity.pipelineStageId === stage.id) {
    return
  }

  const opportunityUpdate = { pipelineStageId: stage.id }
  console.log('Opportunity update:', opportunityUpdate)
  const updatedOpportunity = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(
    accessToken,
    `/opportunities/${existingOpportunity.id}`,
    {
      method: 'PUT',
      body: JSON.stringify(opportunityUpdate),
    }
  )
  console.log(updatedOpportunity)
})
