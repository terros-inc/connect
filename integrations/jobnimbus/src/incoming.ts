import { type AccountId, type WorkflowId, wrapConnectHandler } from '@terros-inc/sdk'
import { cleanNullValue, getRequestType, toMilliseconds } from './util.ts'

type JobNimbusOwner = { email?: string }

type JobNimbusJobPayload = {
  jnid?: string
  external_id?: string
  status_name?: string
  date_status_change?: number | string
  name?: string
  address_line1?: string
  city?: string
  state_text?: string
  zip?: string
  owners?: JobNimbusOwner[]
}

export const handler = wrapConnectHandler<JobNimbusJobPayload>(async (input, client) => {
  const payload = input.context.payload || {}
  const scriptConfig = input.context.config.scriptConfig || {}

  const workflowId = scriptConfig.workflowId
  if (!workflowId) {
    console.log('Missing workflowId config')
    throw Error('No workflowId')
  }

  const accountSource = scriptConfig.accountSource || 'JobNimbus'

  const jobId = payload.jnid
  if (!jobId) {
    console.log('Skipping JobNimbus job webhook; missing jnid')
    throw Error('No jnid detected')
  }

  const statusName = payload.status_name
  if (!statusName) {
    console.log(`Skipping JobNimbus job ${jobId}; missing status_name`, JSON.stringify(payload))
    throw Error('No status name')
  }

  const statusChangedDate = toMilliseconds(payload.date_status_change) || Date.now()
  const ownerEmail = payload.owners?.[0]?.email

  const account = {
    accountId: cleanNullValue(payload.external_id) as AccountId | undefined,
    actorId: cleanNullValue(ownerEmail),
    workflowId: workflowId as WorkflowId,
    workflowTarget: statusName,
    sourceId: jobId,
    sourceStatus: statusName,
    accountSource,
    lastActionDate: statusChangedDate,
    externalLeadId: jobId,
    resident: {
      name: payload.name,
    },
    location: {
      line1: cleanNullValue(payload.address_line1),
      locality: cleanNullValue(payload.city),
      countrySubd: cleanNullValue(payload.state_text),
      postal1: cleanNullValue(payload.zip),
    },
    owner: {
      email: cleanNullValue(ownerEmail),
    },
  }

  console.log('Terros Payload', JSON.stringify(account))

  const requestType = getRequestType(scriptConfig.requestType)

  const result = await client.account.upsert({
    requestType,
    account,
  })

  if (result.type === 'success') {
    console.log(`Updated Terros account from JobNimbus job ${jobId} with status ${statusName}`)
  } else {
    console.log(JSON.stringify(result))
    throw Error('Upsert failed')
  }

  console.log(JSON.stringify(result))
})
