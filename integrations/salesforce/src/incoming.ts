import {
  type AccountId,
  type AccountStatusId,
  type CustomFieldMap,
  type PartialAddress,
  type UserId,
  wrapConnectHandler,
} from '@terros-inc/sdk'

type StatusHistoryItem = {
  statusId: AccountStatusId
  sourceStatus?: string
  statusChangedDate: number
}

type SalesforceAccountWebhookPayload = {
  accountId?: AccountId
  externalLeadId?: string
  statusHistory?: StatusHistoryItem[]
  customFields?: CustomFieldMap
  location?: PartialAddress
  ownerId?: UserId
}

export const handler = wrapConnectHandler<SalesforceAccountWebhookPayload>(async (input, client) => {
  const payload = input.context.payload

  if (!payload.accountId && !payload.externalLeadId) {
    console.log('Skipping: no accountId or externalLeadId in payload')
    return
  }

  const latest = getMostRecentStatusItem(payload.statusHistory)
  if (!latest?.sourceStatus) {
    console.log('Skipping: no status history with a source status in payload')
    return
  }

  // requestType 'upsert' (default) creates the account if no match is found on
  // accountId/externalLeadId, mirroring the sales repo's create-or-update behavior
  // in matchSalesforceAccount/salesforceHandler.
  const response = await client.account.upsert({
    account: {
      accountId: payload.accountId,
      externalLeadId: payload.externalLeadId,
      accountSource: 'Salesforce',
      sourceStatus: latest.sourceStatus,
      workflowTarget: latest.sourceStatus,
      customFields: payload.customFields,
      location: payload.location,
      owner: payload.ownerId ? { userId: payload.ownerId } : undefined,
    },
  })

  console.log('Response', JSON.stringify(response, null, 2))
})

function getMostRecentStatusItem(history?: StatusHistoryItem[]): StatusHistoryItem | undefined {
  if (!history?.length) return
  return [...history].sort((a, b) => b.statusChangedDate - a.statusChangedDate)[0]
}
