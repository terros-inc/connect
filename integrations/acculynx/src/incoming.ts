import { type AccountId, type SmallUser, type TerrosClient, type WorkflowId, wrapConnectHandler } from '@terros-inc/sdk'
import { fromAccuLynxJob, parseJobChange } from './records.ts'
import { AccuLynxClient } from './acculynx.ts'

export type AccuLynxWebhookConfig = {
  workflowId?: string
  requestType?: string
  subscriptionId?: string
  accountSource?: string
  milestoneStageMapping?: Record<string, string>
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
  terros: Pick<TerrosClient, 'account' | 'user'>
): Promise<void> {
  const workflowId = config.workflowId
  if (!workflowId) throw Error('No workflowId')
  const requestType = getRequestType(config.requestType)

  const change = parseJobChange(body)
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
  // one. The body is therefore only a hint: current job data is read back from AccuLynx with this location's key.
  const [milestone, representative] = await Promise.all([
    accuLynx.getCurrentJobMilestone(change.jobId),
    accuLynx.getJobCompanyRepresentative(change.jobId),
  ])
  if (!milestone?.name) {
    console.log(`Ignoring AccuLynx job ${change.jobId}: this location's key cannot read its current milestone`)
    return
  }
  const milestoneName = milestone.name.trim()
  const statusName = milestone.statuses?.find((status) => status.isCurrent)?.name?.trim()
  const sourceStatus = statusName ? `${milestoneName} > ${statusName}` : milestoneName
  const workflowTarget = getWorkflowTarget(milestoneName, statusName, config.milestoneStageMapping)
  if (!workflowTarget)
    console.log(`Skipping stage update for AccuLynx job ${change.jobId}: ${sourceStatus} has no configured mapping`)
  const changedAt = Date.parse(milestone.duration?.startDate ?? '')

  const representativeUserId = representative?.user?.id
  const representativeUser = representativeUserId ? await accuLynx.getUser(representativeUserId) : undefined
  const closer = representativeUser?.email ? await findTerrosUser(representativeUser.email, terros) : undefined

  const references = await accuLynx.getJobExternalReferences(change.jobId)
  const accountId = references.find((reference) => reference.projectId)?.projectId as AccountId | undefined

  if (!accountId && requestType === 'update') {
    console.log(`Skipping AccuLynx job ${change.jobId}: it is not linked to a Terros account`)
    return
  }

  const jobDetails = accountId ? {} : fromAccuLynxJob(await accuLynx.getJob(change.jobId))

  console.log(`Sending AccuLynx job ${change.jobId} status ${sourceStatus} to Terros (${requestType})`)

  const result = await terros.account.upsert({
    requestType: accountId ? 'update' : 'upsert',
    account: {
      ...jobDetails,
      accountId,
      workflowId: workflowId as WorkflowId,
      ...(workflowTarget ? { workflowTarget } : {}),
      sourceId: change.jobId,
      sourceStatus,
      ...(closer ? { closer } : {}),
      accountSource: config.accountSource || 'AccuLynx',
      externalLeadId: change.jobId,
      lastActionDate: Number.isFinite(changedAt) ? changedAt : Date.now(),
    },
  })

  if (result.type !== 'success') throw Error(`Terros account upsert failed for AccuLynx job ${change.jobId}`)
  console.log(`Updated Terros account ${result.account?.accountId} from AccuLynx job ${change.jobId}`)
}

async function findTerrosUser(email: string, terros: Pick<TerrosClient, 'user'>): Promise<SmallUser | undefined> {
  const response = await terros.user.list({ showArchived: false })
  if (response.type !== 'success') return undefined
  const normalizedEmail = email.trim().toLowerCase()
  return response.users.find((user: SmallUser) => user.email.trim().toLowerCase() === normalizedEmail)
}

function getWorkflowTarget(
  milestoneName: string,
  statusName: string | undefined,
  mapping: Record<string, string> | undefined
): string | undefined {
  const sourceStatus = statusName ? `${milestoneName} > ${statusName}` : milestoneName
  if (mapping === undefined) return sourceStatus

  const sourceKey = normalizeMappingName(sourceStatus)
  const milestoneKey = normalizeMappingName(milestoneName)
  const entries = Object.entries(mapping)
  const entry =
    entries.find(([name]) => normalizeMappingName(name) === sourceKey) ??
    (statusName ? entries.find(([name]) => normalizeMappingName(name) === milestoneKey) : undefined)
  return entry?.[1].trim() ? entry[1] : undefined
}

function normalizeMappingName(name: string): string {
  const [milestone, ...status] = name.split('>').map((part) => part.trim().toLowerCase())
  const normalizedMilestone = milestone === 'dead' ? 'cancelled' : (milestone ?? '')
  return status.length ? `${normalizedMilestone} > ${status.join(' > ')}` : normalizedMilestone
}
