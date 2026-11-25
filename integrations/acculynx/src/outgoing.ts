import { createHash } from 'node:crypto'
import { type AccountWebhook, type AccountWebhookData, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'
import {
  type AccuLynxSendConfig,
  getAddressCountry,
  getContactSearchStart,
  getContactSearchTerm,
  getRecordType,
  getSyncStateFieldId,
  isSyncUpdatesOn,
  isTestModeOn,
  matchesAccountFilter,
  matchesTriggerStage,
  toAccuLynxContact,
  toAccuLynxJob,
} from './records.ts'
import { AccuLynxClient, AccuLynxError } from './acculynx.ts'

export const handler = wrapConnectHandler<AccountWebhook, void, AccuLynxSendConfig>(async (input, client) => {
  const payload = input.context.payload
  const config = input.context.config.scriptConfig
  const testMode = isTestModeOn(config.testMode)
  if (payload.action === 'remove') {
    if (testMode) {
      const apiKey = input.context.config.secrets?.apiKey
      if (!apiKey) throw Error('No AccuLynx apiKey')
      await checkConnection(new AccuLynxClient(apiKey, { diagnostics: true }))
    }
    console.log('Skipping AccuLynx send for Account remove')
    return
  }

  const account = payload.data
  if (!account) throw Error('Missing account data')

  const apiKey = input.context.config.secrets?.apiKey
  if (!apiKey) throw Error('No AccuLynx apiKey')

  await sendAccount(account, config, new AccuLynxClient(apiKey, { diagnostics: testMode }), client, testMode)
})

// Creates the AccuLynx contact (and, for recordType 'job', a job for it) the first time an account is sent, then
// saves the AccuLynx ID as the account's externalLeadId. AccuLynx owns the record after that: an account that
// already has an externalLeadId is not sent again.
//
// A delivery can fail between steps and be retried, so each step first looks for what an earlier attempt created
// (the contact by its crossReference, then the job on it that is provably this account's) and creates only what is
// missing. externalLeadId is saved last, so a linked account always has its job reference in AccuLynx.
export async function sendAccount(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  accuLynx: AccuLynxClient,
  terros: Pick<TerrosClient, 'account'>,
  testMode = isTestModeOn(config.testMode)
): Promise<void> {
  if (testMode) await checkConnection(accuLynx)

  const recordType = getRecordType(config.recordType)
  getAddressCountry(undefined, config.addressCountry) // Refuses a bad fallback before anything is created.

  if (testMode) {
    console.log(
      `TEST MODE: evaluating account ${account.id}; stage=${JSON.stringify(account.workflowState?.stageName ?? null)}; ` +
        `filterField=${JSON.stringify(config.accountFilterField ?? null)}; linked=${Boolean(account.externalLeadId)}`
    )
  }

  if (!matchesTriggerStage(account, config)) {
    if (account.externalLeadId && isSyncUpdatesOn(config.syncUpdates)) {
      console.log(`Account ${account.id} is linked; triggerStages does not gate AccuLynx updates`)
    } else {
      console.log(`Skipping account ${account.id}: current stage is not one of this install's trigger stages`)
      return
    }
  }

  if (!matchesAccountFilter(account, config, testMode)) {
    console.log(`Skipping account ${account.id}: ${config.accountFilterField} is not one of this install's values`)
    return
  }

  if (account.externalLeadId) {
    if (!isSyncUpdatesOn(config.syncUpdates)) {
      console.log(`Skipping account ${account.id}: already linked to AccuLynx record ${account.externalLeadId}`)
      return
    }
    await updateLinkedAccount(account, config, recordType, accuLynx, terros, testMode)
    return
  }

  if (testMode) {
    const contact = toAccuLynxContact(account, config)
    console.log(`DRY RUN: account ${account.id} qualifies for AccuLynx ${recordType}`)
    console.log(`DRY RUN: contact payload ${JSON.stringify(contact)}`)
    if (recordType === 'job') {
      console.log(`DRY RUN: job payload ${JSON.stringify(toAccuLynxJob(account, '<created-contact-id>', config))}`)
    }
    return
  }

  const contact = await findOrCreateContact(account, config, accuLynx)
  const externalLeadId = recordType === 'job' ? await findOrCreateJob(account, contact, config, accuLynx) : contact.id
  await readBackCreatedRecord(recordType, externalLeadId, accuLynx)
  const syncStateFieldId = isSyncUpdatesOn(config.syncUpdates)
    ? getSyncStateFieldId(config.syncStateFieldId)
    : undefined
  const updated = await terros.account.update({
    account: {
      accountId: account.id,
      externalLeadId,
      ...(syncStateFieldId
        ? { customFieldsPatch: { [syncStateFieldId]: serializeSyncState(toSyncState(account, config, recordType)) } }
        : {}),
    },
  })
  if (updated.type !== 'success') {
    throw Error(`Failed to save AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
  }
  console.log(`Saved AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
}

type SyncFields = {
  contact: {
    firstName: string
    lastName: string
    companyName: string
    mailingAddress?: Record<string, unknown>
    phone?: string
    email?: string
  }
  job?: { locationAddress?: Record<string, unknown>; leadSourceId?: string }
}

type SyncState = { version: 1; fingerprint: string; sentNoteIds: string[] }

function toSyncState(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  recordType: 'contact' | 'job',
  sentNoteIds = getNoteIds(account)
): SyncState {
  const fields = toSyncFields(account, config, recordType)
  const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('base64url')
  return { version: 1, fingerprint, sentNoteIds: [...new Set(sentNoteIds)].sort() }
}

function toSyncFields(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  recordType: 'contact' | 'job'
): SyncFields {
  const contact = toAccuLynxContact(account, config) as {
    firstName?: string
    lastName?: string
    companyName?: string
    mailingAddress?: Record<string, unknown>
    phoneNumbers?: { number?: string }[]
    emailAddresses?: { address?: string }[]
  }
  const fields: SyncFields = {
    contact: {
      firstName: String(contact.firstName ?? ''),
      lastName: String(contact.lastName ?? ''),
      companyName: String(contact.companyName ?? ''),
      ...(contact.mailingAddress ? { mailingAddress: contact.mailingAddress } : {}),
      ...(contact.phoneNumbers?.[0]?.number ? { phone: contact.phoneNumbers[0].number } : {}),
      ...(contact.emailAddresses?.[0]?.address ? { email: contact.emailAddresses[0].address } : {}),
    },
  }
  if (recordType === 'job') {
    const job = toAccuLynxJob(account, '<contact-id>', config) as {
      locationAddress?: Record<string, unknown>
      leadSource?: { id?: string }
    }
    fields.job = {
      ...(job.locationAddress ? { locationAddress: job.locationAddress } : {}),
      ...(job.leadSource?.id ? { leadSourceId: job.leadSource.id } : {}),
    }
  }
  return fields
}

function getNoteIds(account: AccountWebhookData): string[] {
  return (account.notes ?? []).filter((note) => note.noteId && note.text.trim()).map((note) => note.noteId)
}

function parseSyncState(value: unknown): SyncState | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const state = JSON.parse(value) as Partial<SyncState>
    if (state.version !== 1 || typeof state.fingerprint !== 'string' || !Array.isArray(state.sentNoteIds)) {
      return undefined
    }
    return state as SyncState
  } catch {
    return undefined
  }
}

function serializeSyncState(state: SyncState): string {
  return JSON.stringify(state)
}

async function updateLinkedAccount(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  recordType: 'contact' | 'job',
  accuLynx: AccuLynxClient,
  terros: Pick<TerrosClient, 'account'>,
  testMode: boolean
): Promise<void> {
  const stateFieldId = getSyncStateFieldId(config.syncStateFieldId)
  const previous = parseSyncState(account.customFieldMap?.[stateFieldId])
  if (account.customFieldMap?.[stateFieldId] && !previous) {
    console.error(
      `Account ${account.id} has invalid AccuLynx sync state; rebuilding it without reposting existing notes`
    )
  }

  const alreadySent = new Set(previous?.sentNoteIds ?? getNoteIds(account))
  const newNotes = (account.notes ?? []).filter(
    (note) => note.noteId && note.text.trim() && !alreadySent.has(note.noteId)
  )
  const next = toSyncState(account, config, recordType, [...alreadySent, ...newNotes.map((note) => note.noteId)])
  const desired = toSyncFields(account, config, recordType)
  const fieldsChanged = !previous || previous.fingerprint !== next.fingerprint

  if (!fieldsChanged && newNotes.length === 0) {
    console.log(`Skipping account ${account.id}: no AccuLynx-synced fields or notes changed`)
    return
  }

  const linkedId = account.externalLeadId!
  const job = recordType === 'job' ? await accuLynx.getJob(linkedId) : undefined
  if (recordType === 'job' && !job) throw Error(`Linked AccuLynx job ${linkedId} could not be read`)
  const contactId =
    recordType === 'contact'
      ? linkedId
      : (job!.contacts?.find((item) => item.isPrimary) ?? job!.contacts?.[0])?.contact?.id
  if (!contactId) throw Error(`Linked AccuLynx job ${linkedId} has no contact`)

  const currentContact = await accuLynx.getContact(contactId)
  if (!currentContact) throw Error(`Linked AccuLynx contact ${contactId} could not be read`)
  const contactPayload = {
    firstName: desired.contact.firstName,
    lastName: desired.contact.lastName,
    companyName: desired.contact.companyName,
    ...(desired.contact.mailingAddress ? { mailingAddress: desired.contact.mailingAddress } : {}),
  }
  if (!sameContact(currentContact, contactPayload)) {
    await writeOrLog(testMode, `contact ${contactId}`, contactPayload, () =>
      accuLynx.updateContact(contactId, contactPayload)
    )
  }

  const [emails, phones] = await Promise.all([
    accuLynx.getContactEmailAddresses(contactId),
    accuLynx.getContactPhoneNumbers(contactId),
  ])
  const email = desired.contact.email
  if (email && !emails.some((item) => item.address?.trim().toLowerCase() === email.trim().toLowerCase())) {
    await writeOrLog(testMode, `email for contact ${contactId}`, { address: email }, () =>
      accuLynx.createContactEmailAddress(contactId, email)
    )
  }
  const phone = desired.contact.phone
  if (phone && !phones.some((item) => item.number?.replace(/\D/g, '') === phone)) {
    await writeOrLog(testMode, `phone for contact ${contactId}`, { number: phone }, () =>
      accuLynx.createContactPhoneNumber(contactId, phone)
    )
  }

  if (recordType === 'job') {
    const desiredAddress = desired.job?.locationAddress
    if (desiredAddress && !sameAddress(job!.locationAddress, desiredAddress)) {
      await writeOrLog(testMode, `address for job ${linkedId}`, desiredAddress, () =>
        accuLynx.updateJobAddress(linkedId, desiredAddress)
      )
    }
    const leadSourceId = desired.job?.leadSourceId
    if (leadSourceId && job!.leadSource?.id !== leadSourceId) {
      await writeOrLog(testMode, `lead source for job ${linkedId}`, { id: leadSourceId }, () =>
        accuLynx.updateJobLeadSource(linkedId, leadSourceId)
      )
    }
  }

  for (const note of newNotes) {
    const text = `Terros note ${note.noteId}\n${note.text}`
    if (recordType === 'job') {
      await writeOrLog(testMode, `message for job ${linkedId}`, { message: text }, () =>
        accuLynx.createJobMessage(linkedId, text)
      )
    } else {
      const truncated = text.slice(0, 1000)
      await writeOrLog(testMode, `note for contact ${contactId}`, { note: truncated }, () =>
        accuLynx.createContactNote(contactId, truncated)
      )
    }
    if (!testMode) {
      alreadySent.add(note.noteId)
      await saveSyncState(account.id, stateFieldId, toSyncState(account, config, recordType, [...alreadySent]), terros)
    }
  }

  if (testMode) {
    console.log(`DRY RUN: would save AccuLynx sync state on account ${account.id}`)
    return
  }
  if (newNotes.length > 0) return
  await saveSyncState(account.id, stateFieldId, next, terros)
}

async function saveSyncState(
  accountId: AccountWebhookData['id'],
  stateFieldId: `CF.${string}`,
  state: SyncState,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const updated = await terros.account.update({
    account: { accountId, customFieldsPatch: { [stateFieldId]: serializeSyncState(state) } },
  })
  if (updated.type !== 'success') throw Error(`Failed to save AccuLynx sync state on Terros account ${accountId}`)
}

async function writeOrLog(testMode: boolean, target: string, body: unknown, write: () => Promise<void>): Promise<void> {
  if (testMode) {
    console.log(`DRY RUN: would update AccuLynx ${target}: ${JSON.stringify(body)}`)
    return
  }
  await write()
}

function sameContact(current: Record<string, unknown>, desired: Record<string, unknown>): boolean {
  return (
    String(current.firstName ?? '') === desired.firstName &&
    String(current.lastName ?? '') === desired.lastName &&
    String(current.companyName ?? '') === desired.companyName &&
    (!desired.mailingAddress || sameAddress(current.mailingAddress, desired.mailingAddress as Record<string, unknown>))
  )
}

function sameAddress(current: unknown, desired: Record<string, unknown>): boolean {
  const address = (current ?? {}) as Record<string, unknown>
  const state = address.state as { abbreviation?: string } | string | undefined
  const country = address.country as { abbreviation?: string } | string | undefined
  return (
    String(address.street1 ?? '') === String(desired.street1 ?? '') &&
    String(address.street2 ?? '') === String(desired.street2 ?? '') &&
    String(address.city ?? '') === String(desired.city ?? '') &&
    String(typeof state === 'object' ? state?.abbreviation : (state ?? '')) === String(desired.state ?? '') &&
    String(typeof country === 'object' ? country?.abbreviation : (country ?? '')) === String(desired.country ?? '') &&
    String(address.zipCode ?? '') === String(desired.zipCode ?? '')
  )
}

export async function checkConnection(accuLynx: AccuLynxClient): Promise<void> {
  try {
    const settings = await accuLynx.getCompanySettings()
    console.log(
      `TEST MODE: AccuLynx connection check succeeded for company/location ${accuLynx.safeLogValue(settings.name ?? '<unnamed>')} ` +
        `(${accuLynx.safeLogValue(settings.companyId ?? '<no company id>')})`
    )
  } catch (error) {
    if (error instanceof AccuLynxError && error.status === 401) {
      console.error('TEST MODE: AccuLynx connection check failed: API key is missing, invalid, or deactivated (401)')
    } else {
      console.error(
        `TEST MODE: AccuLynx connection check failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    throw error
  }
}

async function readBackCreatedRecord(
  recordType: 'contact' | 'job',
  id: string,
  accuLynx: AccuLynxClient
): Promise<void> {
  try {
    const record = recordType === 'job' ? await accuLynx.getJob(id) : await accuLynx.getContact(id)
    if (record) {
      console.log(`Confirmed AccuLynx ${recordType} ${id} is readable after create`)
    } else {
      console.log(
        `AccuLynx ${recordType} ${id} was created but is not yet readable${recordType === 'job' ? ' (likely unassigned)' : ''}`
      )
    }
  } catch (error) {
    console.log(
      `AccuLynx ${recordType} ${id} was created, but read-back failed without affecting the send: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

type Found = { id: string; existed: boolean }

async function findOrCreateContact(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  accuLynx: AccuLynxClient
): Promise<Found> {
  const contact = toAccuLynxContact(account, config)
  const existing = await accuLynx.findContactByCrossReference(
    account.id,
    getContactSearchTerm(contact),
    getContactSearchStart(account)
  )
  if (existing?.id) {
    console.log(`Reusing AccuLynx contact ${existing.id} created earlier for account ${account.id}`)
    return { id: existing.id, existed: true }
  }

  const created = await accuLynx.createContact(contact)
  if (!created.id) throw Error(`AccuLynx contact create for account ${account.id} returned no id`)
  console.log(
    `Created AccuLynx contact ${created.id} for account ${account.id}; link=${created._link ?? '<not returned>'}`
  )
  return { id: created.id, existed: false }
}

async function findOrCreateJob(
  account: AccountWebhookData,
  contact: Found,
  config: AccuLynxSendConfig,
  accuLynx: AccuLynxClient
): Promise<string> {
  const existing = contact.existed ? await findEarlierJob(account, contact.id, accuLynx) : undefined
  if (existing?.referenced) {
    console.log(`Reusing AccuLynx job ${existing.id} created earlier for account ${account.id}`)
    return existing.id
  }

  let jobId = existing?.id
  if (jobId) {
    console.log(`Reusing unreferenced AccuLynx job ${jobId}, the only job on account ${account.id}'s contact`)
  } else {
    const job = await accuLynx.createJob(toAccuLynxJob(account, contact.id, config))
    if (!job.id) throw Error(`AccuLynx job create for account ${account.id} returned no id`)
    console.log(`Created AccuLynx job ${job.id} for account ${account.id}; link=${job._link ?? '<not returned>'}`)
    jobId = job.id
  }

  // The webhook finds the account through this reference, so a failure here fails the delivery before linking.
  await accuLynx.createJobExternalReference(jobId, account.id)
  return jobId
}

// The job an earlier attempt created on this account's contact, if one can be proven. People can add more jobs to the
// contact in AccuLynx, so a job counts only when its Terros reference names this account, or, when that reference
// create failed, when it is the contact's only job and has no Terros reference at all: Send creates one job per
// contact. Anything else is ambiguous and a new job is created rather than linking a job of unknown origin.
async function findEarlierJob(
  account: AccountWebhookData,
  contactId: string,
  accuLynx: AccuLynxClient
): Promise<{ id: string; referenced: boolean } | undefined> {
  const jobIds = await accuLynx.getContactJobIds(contactId)
  for (const id of jobIds) {
    const references = await accuLynx.getJobExternalReferences(id)
    if (references.some((reference) => reference.projectId === account.id)) return { id, referenced: true }
    if (jobIds.length === 1 && references.length === 0) return { id, referenced: false }
  }
  return undefined
}
