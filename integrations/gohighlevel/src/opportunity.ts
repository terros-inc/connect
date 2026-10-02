import { type CustomFieldId, type CustomFieldMap, type TerrosClient, type AccountId } from '@terros-inc/sdk'
import { ghlApi, isNotEmpty } from './util.ts'
import { findOpportunity, findStage, getPipeline, toOpportunity, type GoHighLevelOpportunity } from './gohighlevel.ts'
import { toGhlStage } from './config.ts'
import { splitList } from './alerts.ts'

const defaultOpportunityStages = ['Appointment Set']

export type OpportunityConfig = {
  locationId: string
  pipelineId: string
  stageMappings?: Record<string, string>
  /** Terros custom field ID (CF.…) that receives the GoHighLevel opportunity ID. */
  opportunityIdFieldId?: string
}

type OpportunityAccount = {
  id: AccountId
  resident?: Parameters<typeof toOpportunity>[0]['resident']
  customFieldMap?: CustomFieldMap
}

/** Comma-separated Terros stage names that create the opportunity; blank means Appointment Set. */
export function isOpportunityStage(stageName: string | undefined, configured: string | undefined): boolean {
  if (!stageName) return false
  const stages = splitList(configured)
  const normalized = (isNotEmpty(stages) ? stages : defaultOpportunityStages).map((stage) => stage.toLowerCase())
  return normalized.includes(stageName.trim().toLowerCase())
}

/**
 * Creates the account's opportunity in the pipeline stage matching its Terros stage, unless one exists. It looks again
 * just before creating, because another save of the same account may have created it since the caller's first look.
 * Used by Account Sync and by GoHighLevel Resync, so both create an opportunity the same way.
 */
export async function createOpportunityIfMissing(
  client: TerrosClient,
  accessToken: string,
  config: OpportunityConfig,
  account: OpportunityAccount,
  contactId: string,
  assignedTo: string | undefined,
  terrosStageName: string
): Promise<
  { created: GoHighLevelOpportunity; existing?: undefined } | { created?: undefined; existing: GoHighLevelOpportunity }
> {
  const route = { locationId: config.locationId, pipelineId: config.pipelineId }
  const pipeline = await getPipeline(accessToken, config.locationId, config.pipelineId)
  const stage = findStage(pipeline, toGhlStage(terrosStageName, config.stageMappings))
  const existing = await findOpportunity(accessToken, route, contactId)
  if (existing) return { existing }

  const opportunityInput = toOpportunity(
    { accountId: account.id, resident: account.resident },
    route,
    contactId,
    stage.id,
    assignedTo
  )
  const created = await ghlApi<{ opportunity: GoHighLevelOpportunity }>(accessToken, '/opportunities/', {
    method: 'POST',
    body: JSON.stringify(opportunityInput),
  })
  console.log(`Created GoHighLevel opportunity ${created.opportunity.id} for ${account.id} in ${stage.name}`)
  await saveOpportunityId(
    client,
    { id: account.id, customFieldMap: account.customFieldMap },
    config.opportunityIdFieldId,
    created.opportunity.id
  )
  return { created: created.opportunity }
}

// Skips the write when the field is not configured or already holds the id, so the account notification it causes
// settles after one extra run.
export async function saveOpportunityId(
  client: TerrosClient,
  account: { id: AccountId; customFieldMap?: CustomFieldMap },
  fieldId: string | undefined,
  opportunityId: string
): Promise<void> {
  if (!fieldId) return
  if (!fieldId.startsWith('CF.')) {
    console.warn(`Ignoring opportunityIdFieldId ${fieldId}: expected a Terros custom field ID like CF.…`)
    return
  }
  if (account.customFieldMap?.[fieldId as CustomFieldId] === opportunityId) return

  await client.account.upsert({
    requestType: 'update',
    account: { accountId: account.id, customFields: { [fieldId as CustomFieldId]: opportunityId } },
  })
  console.log(`Saved opportunity ${opportunityId} to ${account.id}`)
}
