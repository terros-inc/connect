import {
  type AccountWebhook,
  type AccountWebhookData,
  PermanentError,
  type TerrosClient,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { maskEmail } from './util.ts'
import {
  getCreateSkipReason,
  getStatusName,
  JobNimbusClient,
  type JobNimbusScriptConfig,
  toJobNimbusRecord,
  toNewJobNimbusRecord,
} from './jobnimbus.ts'
import { linkPrimaryContact, syncPrimaryContact } from './contact.ts'

export const handler = wrapConnectHandler<AccountWebhook, void, JobNimbusScriptConfig>(async (input, client) => {
  const account = getAccountToSend(input.context.payload)
  if (!account) return

  const apiKey = input.context.config.secrets?.apiKey
  if (!apiKey) throw Error('No JobNimbus apiKey')

  await sendAccount(account, input.context.config.scriptConfig, new JobNimbusClient(apiKey), client)
})

const accountActions: readonly unknown[] = ['add', 'update', 'remove']

// Terros sends this script only Account webhooks, and every add or update carries the account. Anything else, such as
// a JobNimbus webhook posted to this script's slug, fails the same way on every run, so it is a PermanentError: it
// still counts as a failed run but is not retried. The message names the top-level fields only, never their values.
export function getAccountToSend(payload: unknown): AccountWebhookData | undefined {
  const webhook = (payload ?? {}) as Partial<Record<keyof AccountWebhook, unknown>>
  const fields = Object.keys(webhook).join(', ') || 'none'
  if (webhook.entity !== 'Account' || !accountActions.includes(webhook.action)) {
    throw new PermanentError(
      `Not a Terros Account webhook (fields: ${fields}). It probably reached the outgoing JobNimbus Send script ` +
        'through the wrong slug: JobNimbus webhooks belong at the incoming JobNimbus Webhook script.'
    )
  }
  if (webhook.action === 'remove') {
    console.log('Skipping JobNimbus send: an Account remove has no account to send')
    return
  }
  if (!webhook.data) {
    throw new PermanentError(`The Account ${webhook.action} webhook has no account data (fields: ${fields})`)
  }
  return webhook.data as AccountWebhookData
}

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
  const contactId =
    recordType === 'job'
      ? await syncPrimaryContact(jobNimbus, { account, salesRepId: salesRep.id, scriptConfig })
      : undefined
  const record = linkPrimaryContact(toJobNimbusRecord(account, salesRep.id, scriptConfig, recordType), contactId)

  const linkedId = account.externalLeadId || (await jobNimbus.findByExternalId(path, account.id))?.jnid
  if (linkedId) {
    const updated = await jobNimbus.update(path, linkedId, record)
    // A deleted record is only archived, so the saved link can point at a job nobody in JobNimbus sees.
    if (account.externalLeadId && updated?.is_active === false) {
      console.log(`JobNimbus ${recordType} ${linkedId} for account ${account.id} is archived; sending it as unlinked`)
      return sendAccount({ ...account, externalLeadId: undefined }, scriptConfig, jobNimbus, terros)
    }
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
