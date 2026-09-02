import { wrapConnectHandler } from '@terros-inc/sdk'
import { getPrivateIntegrationToken } from './util.ts'
import { getPipeline, getPipelineStageName } from './gohighlevel.ts'
import { resolveStageName, validateIncomingTeamRoute } from './config.ts'

type ScriptConfig = {
  teamPipelines: Record<string, string>
}

type Secrets = {
  privateIntegrationTokens: Record<string, string>
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
  const match = await client.account.match({ externalLeadId: contactId })
  const account = match.account
  if (!account) {
    throw Error(`No Terros account matched GoHighLevel contact ${contactId} at location ${locationId}`)
  }
  if (!account.teamId) throw Error(`Terros account ${account.accountId} has no teamId`)

  const { team } = await client.team.get({ teamId: account.teamId })
  validateIncomingTeamRoute(scriptConfig, team, locationId, pipelineId)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, locationId)
  const pipeline = await getPipeline(accessToken, locationId, pipelineId)
  const stageName = getPipelineStageName(pipeline, pipelineStageId)
  const workflowTarget = resolveStageName(stageName)

  await client.account.upsert({
    requestType: 'update',
    account: {
      accountId: account.accountId,
      workflowTarget,
      sourceStatus: stageName,
      externalLeadId: contactId,
      lastActionDate: Date.now(),
    },
  })

  console.log(`Updated Terros account ${account.accountId} from GoHighLevel opportunity ${payload.id || '(missing)'}`)
})
