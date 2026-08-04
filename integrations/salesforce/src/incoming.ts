import { type AccountId, type CustomFieldMap, wrapConnectHandler } from '@terros-inc/sdk'

type SalesforceStatusWebhookPayload = {
  Id?: string
  id?: string
  leadId?: string
  accountId?: string
  Status?: string
  status?: string
  customFields?: CustomFieldMap
  location?: {
    line1?: string
    locality?: string
    countrySubd?: string
    postal1?: string
    latitude?: number
    longitude?: number
  }
}

export const handler = wrapConnectHandler<SalesforceStatusWebhookPayload>(async (input, client) => {
  const payload = input.context.payload

  const externalLeadId = payload.Id ?? payload.id ?? payload.leadId
  const status = payload.Status ?? payload.status

  if (!externalLeadId && !payload.accountId) {
    console.log('Skipping: no Salesforce lead id or account id in payload')
    return
  }
  if (!status) {
    console.log('Skipping: no status in payload')
    return
  }

  const { location } = payload

  const response = await client.account.upsert({
    account: {
      accountId: payload.accountId as AccountId | undefined,
      externalLeadId,
      accountSource: 'Salesforce',
      sourceStatus: status,
      workflowTarget: status,
      customFields: payload.customFields,
      location: location && {
        line1: location.line1,
        locality: location.locality,
        countrySubd: location.countrySubd,
        postal1: location.postal1,
        latlng:
          location.latitude !== undefined && location.longitude !== undefined
            ? { latitude: location.latitude, longitude: location.longitude }
            : undefined,
      },
    },
  })

  console.log('Response', JSON.stringify(response, null, 2))
})
