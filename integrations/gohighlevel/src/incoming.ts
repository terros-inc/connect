import { wrapConnectHandler } from '@terros-inc/sdk'
import { ghlApi, isNotEmpty } from './util.ts'
import { getChanges, getIncomingUserIds, getMissingUserIds, getUserInput, type GoHighLevelNote } from './notes.ts'
import { listUsers } from './gohighlevel.ts'
import { hasTerrosStageMapping, isOn, toTerrosStage, type RunSwitches } from './config.ts'

type ScriptConfig = RunSwitches & {
  locationId: string
  stageMappings?: Record<string, string>
}

type Secrets = {
  privateIntegrationToken: string
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

export const handler = wrapConnectHandler<OpportunityWorkflowWebhook, void, ScriptConfig>(async (input, client) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig
  if (isOn(scriptConfig.disabled)) {
    console.log('GoHighLevel Opportunity Webhook is disabled by config, skipping')
    return
  }

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

  if (locationId !== scriptConfig.locationId) {
    throw Error(`GoHighLevel location ${locationId} does not match configured location ${scriptConfig.locationId}`)
  }

  const match = await client.account.match({ externalLeadId: contactId })
  const account = match.account
  if (!account) {
    throw Error(`No account matched contact ${contactId} at location ${locationId}`)
  }
  const workflowTarget = toTerrosStage(stageName, scriptConfig.stageMappings)
  if (hasTerrosStageMapping(stageName, scriptConfig.stageMappings)) {
    console.log(`Resolved pipeline stage ${stageName} to workflow stage ${workflowTarget}`)
  } else {
    console.warn(
      `No stageMappings entry matched pipeline stage ${stageName}; using the GoHighLevel stage name as the Terros workflow stage`
    )
  }

  if (isOn(scriptConfig.dryRun)) {
    console.log(`DRY RUN: would move ${account.accountId} to ${workflowTarget}; nothing was written`)
    return
  }

  // The stage is the point of this webhook: write it before the notes so a notes failure cannot block it.
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
  console.log(
    `Sent workflow stage ${workflowTarget} to ${account.accountId} from GoHighLevel pipeline stage ${stageName}`
  )

  try {
    const secrets = input.context.config.secrets as Secrets
    const accessToken = secrets.privateIntegrationToken
    const { notes: goHighLevelNotes } = await ghlApi<{ notes: GoHighLevelNote[] }>(
      accessToken,
      `/contacts/${contactId}/notes`
    )
    const terrosUserIds = getMissingUserIds(account, goHighLevelNotes)
    const goHighLevelUserIds = getIncomingUserIds(account, goHighLevelNotes)
    const userInput = getUserInput(terrosUserIds, goHighLevelUserIds)
    const [userResponse, goHighLevelUsers] = await Promise.all([
      userInput ? client.user.list(userInput) : undefined,
      listUsers(accessToken, locationId, goHighLevelUserIds),
    ])
    const noteChanges = getChanges(account, goHighLevelNotes, userResponse?.users ?? [], goHighLevelUsers)
    await Promise.all(
      noteChanges.goHighLevelNotes.map((note) =>
        ghlApi<{ note: GoHighLevelNote }>(accessToken, `/contacts/${contactId}/notes`, {
          method: 'POST',
          body: JSON.stringify(note),
        })
      )
    )
    if (isNotEmpty(noteChanges.terrosNotes)) {
      await client.account.upsert({
        requestType: 'update',
        account: { accountId: account.accountId, notes: noteChanges.terrosNotes },
      })
    }
  } catch (error) {
    console.error(
      `Stage for ${account.accountId} was written but importing notes failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
})
