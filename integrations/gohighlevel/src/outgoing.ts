import {
  type AccountId,
  type AccountNote,
  type CustomFieldId,
  type CustomFieldMap,
  type SmallAddress,
  type TerrosClient,
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
  getOpportunityUpdate,
  getPipeline,
  listUsers,
  toContact,
  toOpportunity,
  type GoHighLevelOpportunity,
} from './gohighlevel.ts'
import { checkConfig } from './configFields.ts'
import { isSwitchOn, toGhlStage, type RunSwitches } from './config.ts'
import { hasAlertNote, saveAlertNote, sendAlert, splitList } from './alerts.ts'

type ScriptConfig = RunSwitches & {
  locationId: string
  pipelineId: string
  stageMappings?: Record<string, string>
  contactFieldMappings?: Record<string, string>
  /** Comma-separated Terros stage names that create the opportunity; defaults to Appointment Set. */
  opportunityStages?: string
  /** Terros custom field ID (CF.…) that receives the GoHighLevel opportunity ID. */
  opportunityIdFieldId?: string
  alertWebhookUrl?: string
  alertRecipients?: string
}

const defaultOpportunityStages = ['Appointment Set']
const noCloserAlert = 'no closer'

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
  assignedTo?: string
}

type ContactResponse = {
  contact: GoHighLevelContact
}

export const handler = wrapConnectHandler<AccountChangeWebhook, void, ScriptConfig>(async (input, client) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig
  if (isSwitchOn('disabled', scriptConfig.disabled)) {
    console.log(`GoHighLevel Account Sync is disabled by config, skipping ${payload.data.id}`)
    return
  }
  checkConfig('accountSync', scriptConfig)
  console.log(`Received account ${payload.action} for ${payload.data.id}`)

  if (payload.action === 'remove') {
    console.log(`Skipping sync for removed Terros account ${payload.data.id}`)
    return
  }

  const account = payload.data
  const workflowStageName = account.workflowState?.stageName
  const createsOpportunity = isOpportunityStage(workflowStageName, scriptConfig.opportunityStages)
  const closer = account.closer
  if (!closer) {
    console.log(`Skipping sync for ${account.id}: no closer yet`)
    if (createsOpportunity && !hasAlertNote(account.notes, noCloserAlert)) {
      await sendAlert(scriptConfig, {
        accountId: account.id,
        stage: workflowStageName!,
        message: `Terros account ${account.id} is in ${workflowStageName} with no closer, so it was not synced to GoHighLevel.`,
      })
      await saveAlertNote(client, account.id, noCloserAlert, account.ownerId)
    }
    return
  }

  const { locationId, pipelineId } = scriptConfig
  const secrets = input.context.config.secrets as Secrets
  const accessToken = secrets.privateIntegrationToken
  const assignedTo = await findUserId(accessToken, locationId, closer.email)
  const contactInput = toContact(account, locationId, scriptConfig.contactFieldMappings, assignedTo)
  if (isSwitchOn('dryRun', scriptConfig.dryRun)) {
    console.log(`DRY RUN: would sync account ${account.id} to GoHighLevel; nothing was written`)
    return
  }
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

    // GoHighLevel owns the contact owner once it is set (a reassignment there must survive the next account save);
    // Terros only sets it on creation or fills it when missing, like the opportunity owner.
    const { locationId: _locationId, assignedTo, ...contactFields } = contactInput
    const contactUpdate = existingContact.assignedTo ? contactFields : { ...contactFields, assignedTo }
    contactResponse = await ghlApi<ContactResponse>(accessToken, `/contacts/${account.externalLeadId}`, {
      method: 'PUT',
      body: JSON.stringify(contactUpdate),
    })
  } else {
    contactResponse = await ghlApi<ContactResponse>(accessToken, '/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify(contactInput),
    })
  }
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
  let opportunity = await findOpportunity(accessToken, route, contact.id)
  if (!opportunity) {
    if (!createsOpportunity) {
      console.log(
        `No GoHighLevel opportunity for ${account.id}: ${workflowStageName ?? 'no stage'} does not create one`
      )
      return
    }

    const pipeline = await getPipeline(accessToken, locationId, pipelineId)
    const stage = findStage(pipeline, toGhlStage(workflowStageName!, scriptConfig.stageMappings))
    // Look again just before creating: another save of this account may have created it since the first look.
    opportunity = await findOpportunity(accessToken, route, contact.id)
    if (!opportunity) {
      const opportunityInput = toOpportunity(
        { accountId: account.id, resident: account.resident },
        route,
        contact.id,
        stage.id,
        assignedTo
      )
      const created = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, '/opportunities/', {
        method: 'POST',
        body: JSON.stringify(opportunityInput),
      })
      console.log(`Created GoHighLevel opportunity ${created.opportunity.id} for ${account.id} in ${stage.name}`)
      await saveOpportunityId(client, account, scriptConfig.opportunityIdFieldId, created.opportunity.id)
      return
    }
  }

  await saveOpportunityId(client, account, scriptConfig.opportunityIdFieldId, opportunity.id)
  const opportunityUpdate = getOpportunityUpdate(opportunity, assignedTo)
  if (!opportunityUpdate) {
    console.log(`Left GoHighLevel opportunity ${opportunity.id} as is for ${account.id}`)
    return
  }

  await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, `/opportunities/${opportunity.id}`, {
    method: 'PUT',
    body: JSON.stringify(opportunityUpdate),
  })
})

export function isOpportunityStage(stageName: string | undefined, configured: string | undefined): boolean {
  if (!stageName) return false
  const stages = splitList(configured)
  const normalized = (isNotEmpty(stages) ? stages : defaultOpportunityStages).map((stage) => stage.toLowerCase())
  return normalized.includes(stageName.trim().toLowerCase())
}

// Skips the write when the field is not configured or already holds the id, so the account notification it causes
// settles after one extra run.
async function saveOpportunityId(
  client: TerrosClient,
  account: AccountChangeData,
  fieldId: string | undefined,
  opportunityId: string
): Promise<void> {
  if (!fieldId) return
  if (!fieldId.startsWith('CF.')) {
    console.warn(`Ignoring opportunityIdFieldId ${fieldId}: expected a Terros custom field ID like CF.…`)
    return
  }
  if (account.customFieldMap?.[fieldId as CustomFieldId] === opportunityId) return

  await client.account.upsert({
    requestType: 'update',
    account: { accountId: account.id, customFields: { [fieldId as CustomFieldId]: opportunityId } },
  })
  console.log(`Saved opportunity ${opportunityId} to ${account.id}`)
}
