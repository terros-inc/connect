import { type AccountId, wrapConnectHandler } from '@terros-inc/sdk'

type DocuSignWebhookPayload = {
  event?: string
  data?: {
    envelopeSummary?: {
      customFields?: {
        textCustomFields?: { name: string; value: string }[]
      }
    }
  }
}

export const handler = wrapConnectHandler<DocuSignWebhookPayload>(async (input, client) => {
  const payload = input.context.payload

  console.log('Incoming DocuSign webhook payload:', JSON.stringify(payload))

  const dsEvent = payload.event
  if (!dsEvent) {
    console.log('Skipping: no event name in payload')
    return
  }

  const accountId = findTerrosAccountId(payload)
  if (!accountId) {
    console.log('No terrosAccountId custom field on envelope — ignoring (not a Terros-sent envelope)')
    return
  }

  const response = await client.call('account/upsert', {
    account: {
      accountId: accountId as AccountId,
      workflowTarget: dsEvent,
    },
    requestType: 'update',
  })

  console.log('Response', JSON.stringify(response, null, 2))
})

function findTerrosAccountId(payload: DocuSignWebhookPayload): string | undefined {
  const textFields = payload?.data?.envelopeSummary?.customFields?.textCustomFields || []
  const match = textFields.find((f) => f.name === 'terrosAccountId')
  return match?.value
}
