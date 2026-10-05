import {
  type AccountData,
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
import { findAlertAuthor, hasAlertNote, saveAlertNote, sendAlert, splitList } from './alerts.ts'

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
/**
 * A Terros booking saves the account first and assigns the closer in a follow-up save about a second later, so an
 * account with no closer is read again after this long before it is alerted on. Keep it well inside the 60 second
 * script limit.
 */
export const CLOSER_RECHECK_DELAY_MS = 3000

type Secrets = {
  privateIntegrationToken: string
}

/** A user as the account webhook sends it (SmallUser); the payload has no ownerId or closerId fields. */
type WebhookUser = {
  userId?: UserId
  email?: string
}

type AccountChangeData = {
  id: AccountId
  workflowState?: {
    stageName?: string
  }
  owner?: WebhookUser
  closer?: WebhookUser
  address?: SmallAddress
  resident?: TinyResidentData
  externalLeadId?: string
  customFieldMap?: CustomFieldMap
  notes?: AccountNote[]
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

  let account = payload.data
  let workflowStageName = account.workflowState?.stageName
  let createsOpportunity = isOpportunityStage(workflowStageName, scriptConfig.opportunityStages)
  if (createsOpportunity && !account.closer) {
    const fresh = await rereadAccount(client, account.id)
    if (fresh) {
      account = fresh
      workflowStageName = account.workflowState?.stageName
      createsOpportunity = isOpportunityStage(workflowStageName, scriptConfig.opportunityStages)
    }
  }
  const closer = account.closer
  if (!closer) {
    console.log(`Skipping sync for ${account.id}: no closer yet`)
    if (createsOpportunity && !hasAlertNote(account.notes, noCloserAlert)) {
      await sendAlert(scriptConfig, {
        accountId: account.id,
        stage: workflowStageName!,
        message: `Terros account ${account.id} is in ${workflowStageName} with no closer, so it was not synced to GoHighLevel.`,
      })
      const authorId = await findAlertAuthor(client, account)
      await saveAlertNote(client, account.id, noCloserAlert, authorId)
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

    const { locationId: _locationId, ...contactUpdate } = contactInput
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
      closerId: closer.userId,
      ownerId: account.owner?.userId,
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

/**
 * Waits briefly, then reads the account again so a closer assigned by a follow-up save is not missed. Returns
 * undefined when the read fails, in which case the webhook data stands.
 */
async function rereadAccount(client: TerrosClient, accountId: AccountId): Promise<AccountChangeData | undefined> {
  console.log(`Account ${accountId} has no closer yet; reading it again in ${CLOSER_RECHECK_DELAY_MS}ms`)
  await new Promise((resolve) => setTimeout(resolve, CLOSER_RECHECK_DELAY_MS))
  try {
    const { account } = await client.account.get({ accountId })
    return fromAccountData(account)
  } catch (error) {
    console.warn(`Could not read ${accountId} again: ${error instanceof Error ? error.message : error}`)
  }
}

/** Reshapes an account read through the API into the shape of the account webhook payload. */
export function fromAccountData(account: AccountData): AccountChangeData {
  return {
    id: account.accountId,
    workflowState: { stageName: account.workflowStageName },
    owner: account.ownerId ? { userId: account.ownerId, email: account.owner?.email } : undefined,
    closer: account.closerId ? { userId: account.closerId, email: account.closer?.email } : undefined,
    address: account.location,
    resident: account.resident,
    externalLeadId: account.externalLeadId,
    customFieldMap: account.customFields,
    notes: account.notes,
  }
}

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
