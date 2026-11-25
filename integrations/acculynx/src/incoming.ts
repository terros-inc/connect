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
  const milestone = await accuLynx.getCurrentJobMilestone(change.jobId)
  if (!milestone?.name) {
    console.log(`Ignoring AccuLynx job ${change.jobId}: this location's key cannot read its current milestone`)
    return
  }
  const milestoneName = milestone.name.trim()
  const currentStatus = milestone.statuses?.find((status) => status.isCurrent)
  const statusName = currentStatus?.name?.trim()
  const sourceStatus = statusName ? `${milestoneName} > ${statusName}` : milestoneName
  const workflowTarget = getWorkflowTarget(milestoneName, statusName, config.milestoneStageMapping)
  if (!workflowTarget)
    console.log(`Skipping stage update for AccuLynx job ${change.jobId}: ${sourceStatus} has no valid ID mapping`)
  const references = await accuLynx.getJobExternalReferences(change.jobId)
  const accountId = references.find((reference) => reference.projectId)?.projectId as AccountId | undefined

  if (!accountId && requestType === 'update') {
    console.log(`Skipping AccuLynx job ${change.jobId}: it is not linked to a Terros account`)
    return
  }
  if (!accountId && !workflowTarget) {
    console.log(`Skipping AccuLynx job ${change.jobId}: it is unlinked and ${sourceStatus} has no configured mapping`)
    return
  }

  let closer: SmallUser | undefined
  let closerLookupError: unknown
  let closerLookupFailed = false
  try {
    closer = await resolveCloser(change.jobId, accuLynx, terros)
  } catch (error) {
    closerLookupFailed = true
    closerLookupError = error
  }

  const jobDetails = accountId ? {} : fromAccuLynxJob(await accuLynx.getJob(change.jobId))
  const changedAt = getChangedAt(change.topic, milestone.duration?.startDate, currentStatus?.duration?.startDate)

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
      ...(changedAt === undefined ? {} : { lastActionDate: changedAt }),
    },
  })

  if (result.type !== 'success') throw Error(`Terros account upsert failed for AccuLynx job ${change.jobId}`)
  if (closerLookupFailed) throw closerLookupError
  console.log(`Updated Terros account ${result.account?.accountId} from AccuLynx job ${change.jobId}`)
}

async function resolveCloser(
  jobId: string,
  accuLynx: AccuLynxClient,
  terros: Pick<TerrosClient, 'user'>
): Promise<SmallUser | undefined> {
  const representative = await accuLynx.getJobCompanyRepresentative(jobId)
  const representativeUserId = representative?.user?.id
  if (!representativeUserId) return undefined

  const representativeUser = await accuLynx.getUser(representativeUserId)
  return representativeUser?.email ? await findTerrosUser(representativeUser.email, terros) : undefined
}

async function findTerrosUser(email: string, terros: Pick<TerrosClient, 'user'>): Promise<SmallUser | undefined> {
  try {
    const response = await terros.user.list({ showArchived: false })
    const normalizedEmail = email.trim().toLowerCase()
    return response.users.find((user: SmallUser) => user.email.trim().toLowerCase() === normalizedEmail)
  } catch (error) {
    if (!isTerrosApiError(error) && !isAuthorizationError(error)) throw error
    console.log(`Terros user lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function isTerrosApiError(error: unknown): error is Error & { code: string; response: { type: 'error' } } {
  if (!(error instanceof Error) || error.name !== 'TerrosApiError') return false
  if (!('code' in error) || typeof error.code !== 'string' || !('response' in error)) return false
  return (
    typeof error.response === 'object' &&
    error.response !== null &&
    (error.response as { type?: unknown }).type === 'error'
  )
}

function isAuthorizationError(error: unknown): error is Error & { status: 401 | 403 } {
  if (!(error instanceof Error) || !('status' in error)) return false
  return error.status === 401 || error.status === 403
}

function getChangedAt(
  topic: string,
  milestoneStart: string | undefined,
  statusStart: string | undefined
): number | undefined {
  if (topic.startsWith('job.representatives.')) return undefined
  const start = topic === 'job.milestone.current_changed' ? milestoneStart : statusStart
  const changedAt = Date.parse(start ?? '')
  return Number.isFinite(changedAt) ? changedAt : Date.now()
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
  const targetFor = (key: string): string | undefined => {
    const target = entries.find(([name]) => normalizeMappingName(name) === key)?.[1].trim()
    return target && /^(?:S|A)\.[^\s]+$/.test(target) ? target : undefined
  }
  return targetFor(sourceKey) ?? (statusName ? targetFor(milestoneKey) : undefined)
}

function normalizeMappingName(name: string): string {
  const [milestone, ...status] = name.split('>').map((part) => part.trim().toLowerCase())
  const normalizedMilestone = milestone === 'dead' ? 'cancelled' : (milestone ?? '')
  return status.length ? `${normalizedMilestone} > ${status.join(' > ')}` : normalizedMilestone
}
