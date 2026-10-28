import { type AccountWebhook, type AccountWebhookData, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'
import { maskEmail } from './util.ts'
import {
  getCreateSkipReason,
  getStatusName,
  JobNimbusClient,
  type JobNimbusScriptConfig,
  toJobNimbusRecord,
  toNewJobNimbusRecord,
} from './jobnimbus.ts'

export const handler = wrapConnectHandler<AccountWebhook, void, JobNimbusScriptConfig>(async (input, client) => {
  const payload = input.context.payload
  if (payload.action === 'remove') {
    console.log('Skipping JobNimbus send for Account remove')
    return
  }

  const account = payload.data
  if (!account) throw Error('Missing account data')

  const apiKey = input.context.config.secrets?.apiKey
  if (!apiKey) throw Error('No JobNimbus apiKey')

  await sendAccount(account, input.context.config.scriptConfig, new JobNimbusClient(apiKey), client)
})

// Creates the JobNimbus record the first time a mapped account is sent and updates it after that.
//
// A delivery can fail after the create and be retried, and the saved externalLeadId does not always reach the
// account, so an account without one is first looked up by the account ID that every created record carries in
// external_id. Only when none exists is a record created; otherwise the earlier one is updated and linked again.
export async function sendAccount(
  account: AccountWebhookData,
  scriptConfig: JobNimbusScriptConfig,
  jobNimbus: JobNimbusClient,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const skipReason = account.externalLeadId ? undefined : getCreateSkipReason(account, scriptConfig)
  if (skipReason) {
    console.log(`Skipping JobNimbus create for account ${account.id}: ${skipReason}`)
    return
  }

  const salesRep = await jobNimbus.findUser({ email: account.owner?.email })
  if (!salesRep) {
    console.log(
      `No JobNimbus sales rep id found for account ${account.id} (owner ${account.owner?.userId || maskEmail(account.owner?.email)})`
    )
    throw Error('Cannot assign to a user: No JobNimbus sales rep id found')
  }

  let recordType = (scriptConfig.jobNimbusRecord || 'job').toLowerCase().trim()
  if (recordType !== 'job' && recordType !== 'contact') {
    console.warn(
      `Unsupported jobNimbusRecord "${scriptConfig.jobNimbusRecord}": defaulting to 'job'. Expected 'job' or 'contact'`
    )
    recordType = 'job'
  }
  const path = recordType === 'contact' ? 'contacts' : 'jobs'
  const record = toJobNimbusRecord(account, salesRep.id, scriptConfig, recordType)

  const linkedId = account.externalLeadId || (await jobNimbus.findByExternalId(path, account.id))?.jnid
  if (linkedId) {
    await jobNimbus.update(path, linkedId, record)
    console.log(`Updated JobNimbus ${recordType} ${linkedId} for account ${account.id}`)
    if (account.externalLeadId) return
    await saveExternalLeadId(account, linkedId, terros)
    return
  }

  const created = await jobNimbus.create(
    path,
    toNewJobNimbusRecord(record, getStatusName(account, scriptConfig)!, scriptConfig)
  )
  if (!created?.jnid) {
    console.log(`JobNimbus ${recordType} create response for account ${account.id} did not include jnid`)
    throw Error('Failed to detect jnid from JobNimbus response')
  }
  console.log(`Created JobNimbus ${recordType} ${created.jnid} for account ${account.id}`)
  await saveExternalLeadId(account, created.jnid, terros)
}

async function saveExternalLeadId(
  account: AccountWebhookData,
  jnid: string,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const updated = await terros.account.update({ account: { accountId: account.id, externalLeadId: jnid } })
  if (updated.type !== 'success') {
    console.log(`Failed to update Terros account ${account.id} with externalId ${jnid}`)
    throw Error('Failed to update Terros account with externalId')
  }
  console.log(`Updated Terros account ${account.id} externalId ${jnid}`)
}
