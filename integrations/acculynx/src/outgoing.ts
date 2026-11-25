import { type AccountWebhook, type AccountWebhookData, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'
import {
  type AccuLynxSendConfig,
  getAddressCountry,
  getContactSearchStart,
  getContactSearchTerm,
  getRecordType,
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
  getAddressCountry(config.addressCountry) // Refuses a bad value before anything is created.

  if (testMode) {
    console.log(
      `TEST MODE: evaluating account ${account.id}; stage=${JSON.stringify(account.workflowState?.stageName ?? null)}; ` +
        `filterField=${JSON.stringify(config.accountFilterField ?? null)}; linked=${Boolean(account.externalLeadId)}`
    )
  }

  if (!matchesTriggerStage(account, config)) {
    console.log(`Skipping account ${account.id}: current stage is not one of this install's trigger stages`)
    return
  }

  if (!matchesAccountFilter(account, config, testMode)) {
    console.log(`Skipping account ${account.id}: ${config.accountFilterField} is not one of this install's values`)
    return
  }

  if (account.externalLeadId) {
    console.log(`Skipping account ${account.id}: already linked to AccuLynx record ${account.externalLeadId}`)
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
  const updated = await terros.account.update({ account: { accountId: account.id, externalLeadId } })
  if (updated.type !== 'success') {
    throw Error(`Failed to save AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
  }
  console.log(`Saved AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
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
