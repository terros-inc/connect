import { type AccountWebhook, wrapConnectHandler } from '@terros-inc/sdk'
import {
  createJobNimbusRecord,
  getCreateSkipReason,
  getSalesRepId,
  getStatusName,
  type JobNimbusScriptConfig,
  toJobNimbusRecord,
  toNewJobNimbusRecord,
  updateJobNimbusRecord,
} from './jobnimbus.ts'
import { maskEmail } from './util.ts'

export const handler = wrapConnectHandler<AccountWebhook, void, JobNimbusScriptConfig>(async (input, client) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig
  const secrets = input.context.config.secrets || {}

  if (payload.action === 'remove') {
    console.log('Skipping JobNimbus send for Account remove')
    return
  }

  const account = payload.data
  if (!account) {
    throw Error('Missing account data')
  }

  const apiKey = secrets.apiKey
  if (!apiKey) {
    throw Error('No JobNimbus apiKey')
  }

  const skipReason = account.externalLeadId ? undefined : getCreateSkipReason(account, scriptConfig)
  if (skipReason) {
    console.log(`Skipping JobNimbus create for account ${account.id}: ${skipReason}`)
    return
  }

  const salesRepId = await getSalesRepId(account.owner, apiKey)
  if (!salesRepId) {
    console.log(
      `No JobNimbus sales rep id found for account ${account.id} (owner ${account.owner?.userId || maskEmail(account.owner?.email)})`
    )
    throw Error('Cannot assign to a user: No JobNimbus sales rep id found')
  }

  let jobNimbusRecord = (scriptConfig.jobNimbusRecord || 'job').toLowerCase().trim()

  if (jobNimbusRecord !== 'job' && jobNimbusRecord !== 'contact') {
    console.warn(
      `Unsupported jobNimbusRecord "${scriptConfig.jobNimbusRecord}": defaulting to 'job'. Expected 'job' or 'contact'`
    )
    jobNimbusRecord = 'job'
  }

  const jobNimbusPath = `${jobNimbusRecord}s`

  const record = toJobNimbusRecord(account, salesRepId, scriptConfig, jobNimbusRecord)

  if (account.externalLeadId) {
    const updatedRecord = await updateJobNimbusRecord(apiKey, jobNimbusPath, account.externalLeadId, record)
    if (!updatedRecord) {
      throw Error(`Failed to update JobNimbus ${jobNimbusRecord} ${account.externalLeadId} for account ${account.id}`)
    }

    console.log(`Updated JobNimbus ${jobNimbusRecord} ${account.externalLeadId} for account ${account.id}`)
    return
  }

  const statusName = getStatusName(account, scriptConfig) || ''
  const createdRecord = await createJobNimbusRecord(
    apiKey,
    jobNimbusPath,
    toNewJobNimbusRecord(record, statusName, scriptConfig)
  )
  if (!createdRecord?.jnid) {
    console.log(`JobNimbus ${jobNimbusRecord} create response for account ${account.id} did not include jnid`)
    throw Error('Failed to detect jnid from JobNimbus response')
  }

  console.log(`Created JobNimbus ${jobNimbusRecord} ${createdRecord.jnid} for account ${account.id}`)

  const updated = await client.account.update({
    account: {
      accountId: account.id,
      externalLeadId: createdRecord.jnid,
    },
  })

  if (updated.type === 'success') {
    console.log(`Updated Terros account ${account.id} externalId ${createdRecord.jnid}`)
  } else {
    console.log(`Failed to update Terros account ${account.id} with externalId ${createdRecord.jnid}`)
    throw Error('Failed to update Terros account with externalId')
  }
})
