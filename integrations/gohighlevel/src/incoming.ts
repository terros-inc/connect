import {
  type AccountId,
  type AccountUpsertSuccess,
  type TeamId,
  type TerrosClient,
  type WorkflowId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { getPipeline, getPipelineStageName } from './gohighlevel.ts'
import { resolveIncomingTeamRoute, resolveStageName } from './config.ts'

type ScriptConfig = {
  teamLocations: Record<string, string>
  teamPipelines: Record<string, string>
  teamWorkflows: Record<string, string>
}

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
  if (payload.type !== 'OpportunityStageUpdate') {
    console.log(`Skipping unsupported GoHighLevel webhook type ${payload.type || '(missing)'}`)
    return
  }

  const { locationId, pipelineId, pipelineStageId, contactId } = payload
  if (!locationId) throw Error('GoHighLevel OpportunityStageUpdate is missing locationId')
  if (!pipelineId) throw Error('GoHighLevel OpportunityStageUpdate is missing pipelineId')
  if (!pipelineStageId) throw Error('GoHighLevel OpportunityStageUpdate is missing pipelineStageId')
  if (!contactId) throw Error('GoHighLevel OpportunityStageUpdate is missing contactId')

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const route = resolveIncomingTeamRoute(scriptConfig, locationId, pipelineId)
  if (!route) {
    console.log(`Skipping unconfigured GoHighLevel location ${locationId} and pipeline ${pipelineId}`)
    return
  }

  const apiKey = input.context.config.secrets.apiKey
  if (!apiKey) throw Error('Missing GoHighLevel apiKey')
  const pipeline = await getPipeline(apiKey, locationId, pipelineId)
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

// this function doesn't serve much purpose. additionally, we're passing in account id, we do not need to pass in team id, and most definitely not workflow id
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
