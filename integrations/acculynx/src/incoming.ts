import { type AccountId, type TerrosClient, type WorkflowId, wrapConnectHandler } from '@terros-inc/sdk'
import { fromAccuLynxJob, parseMilestoneChange } from './records.ts'
import { AccuLynxClient } from './acculynx.ts'

export type AccuLynxWebhookConfig = {
  workflowId?: string
  requestType?: string
  subscriptionId?: string
  accountSource?: string
}

export const handler = wrapConnectHandler<unknown, void, AccuLynxWebhookConfig>(async (input, client) => {
  const apiKey = input.context.config.secrets?.apiKey
  if (!apiKey) throw Error('No AccuLynx apiKey')

  await receiveWebhook(input.context.payload, input.context.config.scriptConfig, new AccuLynxClient(apiKey), client)
})

// Neither mode is a default. 'update' only moves accounts already linked to the job (jobs Terros sent);
// 'upsert' also creates an account for a job that was started in AccuLynx.
function getRequestType(value: string | undefined): 'update' | 'upsert' {
  const requestType = String(value || '')
    .trim()
    .toLowerCase()
  if (requestType === 'update' || requestType === 'upsert') return requestType
  throw Error(`requestType must be 'update' or 'upsert', got "${value ?? ''}"`)
}

export async function receiveWebhook(
  body: unknown,
  config: AccuLynxWebhookConfig,
  accuLynx: AccuLynxClient,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const workflowId = config.workflowId
  if (!workflowId) throw Error('No workflowId')
  const requestType = getRequestType(config.requestType)

  const change = parseMilestoneChange(body)
  if (!change) {
    console.log(`Ignoring AccuLynx webhook topic ${(body as { topicName?: string })?.topicName}`)
    return
  }

  // Each AccuLynx location has its own subscription. Pinning it keeps one location's install from acting on
  // another location's events.
  if (config.subscriptionId && change.subscriptionId !== config.subscriptionId) {
    throw Error(`AccuLynx webhook is from subscription ${change.subscriptionId}, not ${config.subscriptionId}`)
  }

  const references = await accuLynx.getJobExternalReferences(change.jobId)
  const accountId = references.find((reference) => reference.projectId)?.projectId as AccountId | undefined

  if (!accountId && requestType === 'update') {
    console.log(`Skipping AccuLynx job ${change.jobId}: it is not linked to a Terros account`)
    return
  }

  const jobDetails = accountId ? {} : fromAccuLynxJob(await accuLynx.getJob(change.jobId))

  console.log(`Sending AccuLynx job ${change.jobId} milestone ${change.milestoneName} to Terros (${requestType})`)

  const result = await terros.account.upsert({
    requestType: accountId ? 'update' : 'upsert',
    account: {
      ...jobDetails,
      accountId,
      workflowId: workflowId as WorkflowId,
      workflowTarget: change.milestoneName,
      sourceId: change.jobId,
      sourceStatus: change.milestoneName,
      accountSource: config.accountSource || 'AccuLynx',
      externalLeadId: change.jobId,
      lastActionDate: change.changedAt ?? Date.now(),
    },
  })

  if (result.type !== 'success') throw Error(`Terros account upsert failed for AccuLynx job ${change.jobId}`)
  console.log(`Updated Terros account ${result.account?.accountId} from AccuLynx job ${change.jobId}`)
}
