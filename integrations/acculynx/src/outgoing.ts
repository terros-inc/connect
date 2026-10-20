import { type AccountWebhook, type AccountWebhookData, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'
import {
  type AccuLynxSendConfig,
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
export async function sendAccount(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  accuLynx: AccuLynxClient,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const recordType = getRecordType(config.recordType)

  if (!matchesAccountFilter(account, config)) {
    console.log(`Skipping account ${account.id}: ${config.accountFilterField} is not one of this install's values`)
    return
  }

  if (account.externalLeadId) {
    console.log(`Skipping account ${account.id}: already linked to AccuLynx record ${account.externalLeadId}`)
    return
  }

  const contact = await accuLynx.createContact(toAccuLynxContact(account, config))
  if (!contact.id) throw Error(`AccuLynx contact create for account ${account.id} returned no id`)
  console.log(`Created AccuLynx contact ${contact.id} for account ${account.id}`)

  let externalLeadId = contact.id
  if (recordType === 'job') {
    let job
    try {
      job = await accuLynx.createJob(toAccuLynxJob(account, contact.id, config))
    } catch (error) {
      console.log(`AccuLynx contact ${contact.id} was created for account ${account.id} but its job was not`)
      throw error
    }
    if (!job.id) throw Error(`AccuLynx job create for account ${account.id} returned no id`)
    console.log(`Created AccuLynx job ${job.id} for account ${account.id}`)
    externalLeadId = job.id
  }

  const updated = await terros.account.update({ account: { accountId: account.id, externalLeadId } })
  if (updated.type !== 'success') {
    throw Error(`Failed to save AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)
  }
  console.log(`Saved AccuLynx ${recordType} ${externalLeadId} on Terros account ${account.id}`)

  if (recordType === 'job') {
    // Lets the AccuLynx webhook find this account later. The account is already linked, so a failure only warns.
    try {
      await accuLynx.createJobExternalReference(externalLeadId, account.id)
    } catch (error) {
      console.warn(`Could not add the Terros external reference to AccuLynx job ${externalLeadId}: ${error}`)
    }
  }
}
