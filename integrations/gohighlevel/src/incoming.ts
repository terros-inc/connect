import { wrapConnectHandler } from '@terros-inc/sdk'
import { resolveTerrosStageName, validateIncomingTeamLocation } from './config.ts'

type ScriptConfig = {
  stageMappings?: Record<string, string>
}

type OpportunityWorkflowWebhook = {
  location?: {
    id?: string
  }
  contact_id?: string
  customData?: {
    pipeline_stage?: string
  }
}

export const handler = wrapConnectHandler<OpportunityWorkflowWebhook>(async (input, client) => {
  const payload = input.context.payload
  const customDataFields =
    Object.keys(payload.customData ?? {})
      .sort()
      .join(', ') || '(none)'
  console.log(
    `Received update for contact ${payload.contact_id || '(missing)'} with custom data fields ${customDataFields}`
  )

  const locationId = payload.location?.id
  const contactId = payload.contact_id
  const stageName = payload.customData?.pipeline_stage
  if (!locationId) throw Error('GoHighLevel workflow webhook is missing location.id')
  if (!contactId) throw Error('GoHighLevel workflow webhook is missing contact_id')
  if (!stageName) throw Error('GoHighLevel workflow webhook is missing customData.pipeline_stage')

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const match = await client.account.match({ externalLeadId: contactId })
  const account = match.account
  if (!account) {
    throw Error(`No account matched contact ${contactId} at location ${locationId}`)
  }
  if (!account.teamId) throw Error(`Account ${account.accountId} has no teamId`)

  const { team } = await client.team.get({ teamId: account.teamId })
  console.log(`Found team ${team.teamId} for account ${account.accountId}`)
  validateIncomingTeamLocation(team, locationId)
  const workflowTarget = resolveTerrosStageName(stageName, scriptConfig.stageMappings)
  console.log(`Resolved pipeline stage ${stageName} to workflow stage ${workflowTarget}`)

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

  console.log(`Updated ${account.accountId} from GoHighLevel pipeline stage ${stageName}`)
})
