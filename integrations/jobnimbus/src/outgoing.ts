import { type AccountWebhook, wrapConnectHandler } from '@terros-inc/sdk'
import { createJobNimbusRecord, getSalesRepId, toJobNimbusRecord, updateJobNimbusRecord } from './jobnimbus.ts'

export const handler = wrapConnectHandler<AccountWebhook>(async (input, client) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig || {}
  const secrets = input.context.config.secrets || {}

  if (payload.action === 'remove') {
    console.log('Skipping JobNimbus send for Account remove')
    throw Error('Account removed: not firing')
  }

  const account = payload.data
  if (!account) {
    console.log('Missing account payload data', JSON.stringify(payload.data))
    throw Error('Missing account data')
  }

  const apiKey = secrets.apiKey
  if (!apiKey) {
    console.log('Missing JobNimbus apiKey secret')
    throw Error('No JobNimbus apiKey')
  }

  const salesRepId = await getSalesRepId(account.owner, apiKey)
  if (!salesRepId) {
    console.log(`No JobNimbus sales rep id found for ${account.owner?.email || account.ownerId || 'missing owner'}`)
    throw Error('Cannot assign to a user: No JobNimbus sales rep id found')
  }

  const jobNimbusRecord = (scriptConfig.jobNimbusRecord || 'job').toLowerCase().trim()
  const jobNimbusPath = `${jobNimbusRecord}s`

  if (jobNimbusRecord !== 'job' && jobNimbusRecord !== 'contact') {
    console.warn(
      `Unsupported jobNimbusRecord "${scriptConfig.jobNimbusRecord}": using job payload fields. Expected 'job' or 'contact'`
    )
    console.log('Please double check that you have input jobNimbusRecord correctly.')
  }

  const record = toJobNimbusRecord(account, salesRepId, scriptConfig, jobNimbusRecord)
  if (!record) {
    throw Error('Failed to build record to push to JobNimbus')
  }

  if (account.externalLeadId) {
    const updatedRecord = await updateJobNimbusRecord(apiKey, jobNimbusPath, account.externalLeadId, record)
    if (!updatedRecord) return

    console.log(`Updated JobNimbus ${jobNimbusRecord} ${account.externalLeadId} for account ${account.id}`)
    return
  }

  const createdRecord = await createJobNimbusRecord(apiKey, jobNimbusPath, record)
  if (!createdRecord?.jnid) {
    console.log(`JobNimbus ${jobNimbusRecord} create response did not include jnid`)
    throw Error('Failed to detected jnid from JobNimbus response')
  }

  console.log('Created JobNimbus', JSON.stringify(createdRecord))

  const updated = await client.account.update({
    account: {
      accountId: account.id,
      externalLeadId: createdRecord.jnid,
    },
  })

  if (updated.type === 'success') {
    console.log(`Updated Terros account externalId ${createdRecord.jnid}`)
  } else {
    console.log(JSON.stringify(updated))
    throw Error('Failed to update Terros account with externalId')
  }
})
