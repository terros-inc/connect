import { type AccountWebhook, type AccountWebhookData, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'
import {
  type AccuLynxSendConfig,
  getAddressCountry,
  getContactSearchStart,
  getContactSearchTerm,
  getRecordType,
  matchesAccountFilter,
  toAccuLynxContact,
  toAccuLynxJob,
} from './records.ts'
import { AccuLynxClient } from './acculynx.ts'

export const handler = wrapConnectHandler<AccountWebhook, void, AccuLynxSendConfig>(async (input, client) => {
  const payload = input.context.payload
  if (payload.action === 'remove') {
    console.log('Skipping AccuLynx send for Account remove')
    return
  }

  const account = payload.data
  if (!account) throw Error('Missing account data')

  const apiKey = input.context.config.secrets?.apiKey
  if (!apiKey) throw Error('No AccuLynx apiKey')

  await sendAccount(account, input.context.config.scriptConfig, new AccuLynxClient(apiKey), client)
})

// Creates the AccuLynx contact (and, for recordType 'job', a job for it) the first time an account is sent, then
// saves the AccuLynx ID as the account's externalLeadId. AccuLynx owns the record after that: an account that
// already has an externalLeadId is not sent again.
//
// A delivery can fail between steps and be retried, so each step first looks for what an earlier attempt created
// (the contact by its crossReference, then the contact's job, then the job's Terros reference) and creates only what
// is missing. externalLeadId is saved last, so a linked account always has its job reference in AccuLynx.
export async function sendAccount(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  accuLynx: AccuLynxClient,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const recordType = getRecordType(config.recordType)
  getAddressCountry(config.addressCountry) // Refuses a bad value before anything is created.

  if (!matchesAccountFilter(account, config)) {
    console.log(`Skipping account ${account.id}: ${config.accountFilterField} is not one of this install's values`)
    return
  }

  if (account.externalLeadId) {
    console.log(`Skipping account ${account.id}: already linked to AccuLynx record ${account.externalLeadId}`)
    return
  }

  const contact = await findOrCreateContact(account, config, accuLynx)
  const externalLeadId = recordType === 'job' ? await findOrCreateJob(account, contact, config, accuLynx) : contact.id
  const updated = await terros.account.update({ account: { accountId: account.id, externalLeadId } })
  if (updated.type !== 'success') {
    throw Error(`Failed to save AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
  }
  console.log(`Saved AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
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
  console.log(`Created AccuLynx contact ${created.id} for account ${account.id}`)
  return { id: created.id, existed: false }
}

async function findOrCreateJob(
  account: AccountWebhookData,
  contact: Found,
  config: AccuLynxSendConfig,
  accuLynx: AccuLynxClient
): Promise<string> {
  // The contact was created for this account, so a job on it is the one an earlier attempt created.
  const existingJobId = contact.existed ? (await accuLynx.getContactJobIds(contact.id))[0] : undefined
  let jobId = existingJobId
  if (jobId) {
    console.log(`Reusing AccuLynx job ${jobId} created earlier for account ${account.id}`)
  } else {
    const job = await accuLynx.createJob(toAccuLynxJob(account, contact.id, config))
    if (!job.id) throw Error(`AccuLynx job create for account ${account.id} returned no id`)
    console.log(`Created AccuLynx job ${job.id} for account ${account.id}`)
    jobId = job.id
  }

  // The webhook finds the account through this reference, so a failure here fails the delivery before linking.
  const references = existingJobId ? await accuLynx.getJobExternalReferences(jobId) : []
  if (!references.some((reference) => reference.projectId === account.id)) {
    await accuLynx.createJobExternalReference(jobId, account.id)
  }
  return jobId
}
