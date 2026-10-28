import { type AccountId, type TerrosClient, type WorkflowId, wrapConnectHandler } from '@terros-inc/sdk'
import { cleanNullValue, getRequestType, toMilliseconds } from './util.ts'
import { JobNimbusClient } from './jobnimbus.ts'

type JobNimbusScriptConfig = {
  accountSource?: string
  requestType?: string
  workflowId?: string
}

export const handler = wrapConnectHandler<unknown, void, JobNimbusScriptConfig>(async (input, client) => {
  const apiKey = input.context.config.secrets?.apiKey
  if (!apiKey) throw Error("No JobNimbus apiKey: add the JobNimbus API key as this script's apiKey secret")

  await receiveWebhook(input.context.payload, input.context.config.scriptConfig, new JobNimbusClient(apiKey), client)
})

export async function receiveWebhook(
  body: unknown,
  scriptConfig: JobNimbusScriptConfig,
  jobNimbus: JobNimbusClient,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const workflowId = scriptConfig.workflowId
  if (!workflowId) {
    console.log('Missing workflowId config')
    throw Error('No workflowId')
  }

  const jobId = cleanNullValue((body as { jnid?: string } | undefined)?.jnid)
  if (!jobId) {
    console.log('Skipping JobNimbus job webhook; missing jnid')
    throw Error('No jnid detected')
  }

  // JobNimbus Automation webhooks are not signed and Connect gives this script only the body, so anyone with the
  // URL could post one. The body is therefore only a hint: the job is read back from JobNimbus with this install's
  // key, and its status, name, address, owner and linked account come from there, never from the body. A forged
  // event can at most re-apply a real job's current status, and a jnid this key cannot read is ignored.
  const job = await jobNimbus.getJob(jobId)
  if (!job?.status_name) {
    console.log(`Ignoring JobNimbus job ${jobId}: this install's key cannot read it or it has no status`)
    return
  }
  const statusName = job.status_name

  const ownerId = job.owners?.[0]?.id || job.sales_rep
  const ownerEmail = ownerId ? cleanNullValue((await jobNimbus.findUser({ id: ownerId }))?.email) : undefined

  const account = {
    accountId: cleanNullValue(job.external_id) as AccountId | undefined,
    actorId: ownerEmail,
    workflowId: workflowId as WorkflowId,
    workflowTarget: statusName,
    sourceId: jobId,
    sourceStatus: statusName,
    accountSource: scriptConfig.accountSource || 'JobNimbus',
    lastActionDate: toMilliseconds(job.date_status_change) || Date.now(),
    externalLeadId: jobId,
    resident: {
      name: job.name,
    },
    location: {
      line1: cleanNullValue(job.address_line1),
      locality: cleanNullValue(job.city),
      countrySubd: cleanNullValue(job.state_text),
      postal1: cleanNullValue(job.zip),
    },
    owner: {
      email: ownerEmail,
    },
  }

  const requestType = getRequestType(scriptConfig.requestType)

  console.log(
    `Upserting Terros account for JobNimbus job ${jobId} with status ${statusName} (requestType: ${requestType})`
  )

  const result = await terros.account.upsert({ requestType, account })

  if (result.type !== 'success') {
    console.log(`Upsert failed for JobNimbus job ${jobId}`)
    throw Error('Upsert failed')
  }
  console.log(
    `Updated Terros account ${result.account?.accountId} from JobNimbus job ${jobId} with status ${statusName}`
  )
}
