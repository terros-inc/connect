import {
  type AccountId,
  type AccountUpsertSuccess,
  type TeamId,
  type TerrosClient,
  type WorkflowId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { getPipeline, getPipelineStageName, type GoHighLevelConfig } from './gohighlevel.ts'
import { parseScriptConfig, resolveIncomingTeamRoute, resolveStageName } from './config.ts'

type OpportunityStageUpdate = {
  type?: string
  locationId?: string
  id?: string
  contactId?: string
  pipelineId?: string
  pipelineStageId?: string
}

export const handler = wrapConnectHandler<OpportunityStageUpdate>(async (input, client) => {
  const payload = input.context.payload
  // note sure I like this check, would love to see a justification for it
  if (payload.type !== 'OpportunityStageUpdate') {
    console.log(`Skipping unsupported GoHighLevel webhook type ${payload.type || '(missing)'}`)
    return
  }

  const { locationId, pipelineId, pipelineStageId, contactId } = payload
  // split this out into individual checks with more specific messages
  if (!locationId || !pipelineId || !pipelineStageId || !contactId) {
    throw Error('GoHighLevel OpportunityStageUpdate is missing locationId, pipelineId, pipelineStageId, or contactId')
  }

  const scriptConfig = parseScriptConfig(input.context.config.scriptConfig)
  const route = resolveIncomingTeamRoute(scriptConfig, locationId, pipelineId)
  if (!route) {
    console.log(`Skipping unconfigured GoHighLevel location ${locationId} and pipeline ${pipelineId}`)
    return
  }

  const apiKey = input.context.config.secrets.apiKey
  if (!apiKey) throw Error('Missing GoHighLevel apiKey')
  const ghlConfig: GoHighLevelConfig = { apiKey }
  const pipeline = await getPipeline(ghlConfig, locationId, pipelineId)
  const stageName = getPipelineStageName(pipeline, pipelineStageId)
  const workflowTarget = resolveStageName(stageName)

  const match = await client.account.match({ externalLeadId: contactId })
  const account = match.account
  if (!account) {
    throw Error(`No Terros account matched GoHighLevel contact ${contactId} at location ${locationId}`)
  }
  if (account.teamId !== route.teamId) {
    throw Error(
      `Terros account ${account.accountId} belongs to team ${account.teamId || '(missing)'}, expected ${route.teamId}`
    )
  }

  await updateTerrosAccount(client, {
    accountId: account.accountId,
    teamId: route.teamId,
    workflowId: route.workflowId,
    workflowTarget,
    stageName,
    contactId,
  })

  console.log(`Updated Terros account ${account.accountId} from GoHighLevel opportunity ${payload.id || '(missing)'}`)
})

async function updateTerrosAccount(
  client: TerrosClient,
  input: {
    accountId: AccountId
    teamId: TeamId
    workflowId: WorkflowId
    workflowTarget: string
    stageName: string
    contactId: string
  }
): Promise<AccountUpsertSuccess> {
  return await client.account.upsert({
    requestType: 'update',
    account: {
      accountId: input.accountId,
      teamId: input.teamId,
      workflowId: input.workflowId,
      workflowTarget: input.workflowTarget,
      sourceStatus: input.stageName,
      externalLeadId: input.contactId,
      lastActionDate: Date.now(),
    },
  })
}
