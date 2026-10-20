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
  // another location's events. The ID comes from the body, so this routes events; it does not authenticate them.
  if (config.subscriptionId && change.subscriptionId !== config.subscriptionId) {
    throw Error(`AccuLynx webhook is from subscription ${change.subscriptionId}, not ${config.subscriptionId}`)
  }

  // AccuLynx does not sign webhooks and Connect gives this script only the body, so anyone with the URL could post
  // one. The body is therefore only a hint: the milestone is read back from AccuLynx with this location's key. A
  // forged event can at most re-apply a real job's current milestone, and a job this key cannot see is ignored.
  const milestone = await accuLynx.getCurrentJobMilestone(change.jobId)
  if (!milestone?.name) {
    console.log(`Ignoring AccuLynx job ${change.jobId}: this location's key cannot read its current milestone`)
    return
  }
  const changedAt = Date.parse(milestone.duration?.startDate ?? '')

  const references = await accuLynx.getJobExternalReferences(change.jobId)
  const accountId = references.find((reference) => reference.projectId)?.projectId as AccountId | undefined

  if (!accountId && requestType === 'update') {
    console.log(`Skipping AccuLynx job ${change.jobId}: it is not linked to a Terros account`)
    return
  }

  const jobDetails = accountId ? {} : fromAccuLynxJob(await accuLynx.getJob(change.jobId))

  console.log(`Sending AccuLynx job ${change.jobId} milestone ${milestone.name} to Terros (${requestType})`)

  const result = await terros.account.upsert({
    requestType: accountId ? 'update' : 'upsert',
    account: {
      ...jobDetails,
      accountId,
      workflowId: workflowId as WorkflowId,
      workflowTarget: milestone.name,
      sourceId: change.jobId,
      sourceStatus: milestone.name,
      accountSource: config.accountSource || 'AccuLynx',
      externalLeadId: change.jobId,
      lastActionDate: Number.isFinite(changedAt) ? changedAt : Date.now(),
    },
  })

  if (result.type !== 'success') throw Error(`Terros account upsert failed for AccuLynx job ${change.jobId}`)
  console.log(`Updated Terros account ${result.account?.accountId} from AccuLynx job ${change.jobId}`)
}
