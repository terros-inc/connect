import {
  type AccountData,
  type AccountId,
  type AccountUpdateSuccess,
  type WebhookAuditProps,
  type WebhookPayload,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import type { SalesforceLeadAddRequest } from './model'
import { addLead } from './api'

type ResidentDetails = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
}

type WebhookAccountData = WebhookAuditProps &
  Omit<AccountData, 'accountId' | 'resident'> & {
    id: AccountId
    resident?: ResidentDetails
  }
type WebhookAccount = WebhookPayload<'Account', WebhookAccountData, 'id'>

export const handler = wrapConnectHandler<WebhookAccount>(async (input, client) => {
  const { payload, config } = input.context
  const { secrets, scriptConfig } = config
  const { clientId, clientSecret, url } = secrets

  if (payload.action === 'remove') return
  if (payload.data.externalLeadId) return

  if (!clientId) throw new Error('Missing Salesforce clientId')
  if (!clientSecret) throw new Error('Missing Salesforce clientSecret')
  if (!url) throw new Error('Missing Salesforce url')

  const leadInput = toSalesforceLead(payload, scriptConfig.leadType)
  if (!leadInput) return

  const response = await addLead({ clientId, clientSecret, url }, leadInput)

  await client.call<AccountUpdateSuccess>('account/update', {
    account: {
      accountId: payload.data.id,
      externalLeadId: response.id,
    },
  })
})

function toSalesforceLead(account: WebhookAccount, leadType?: string): SalesforceLeadAddRequest | undefined {
  if (account.action === 'remove') return

  const { resident, location } = account.data
  if (!resident?.firstName || !resident?.lastName || !resident?.email) return

  return {
    FirstName: resident.firstName,
    LastName: resident.lastName,
    Email: resident.email,
    Company: `${resident.firstName} ${resident.lastName}`,
    Street: location?.line1,
    City: location?.locality,
    State: location?.countrySubd,
    PostalCode: location?.postal1,
    Latitude_Longitude__latitude__s: location?.latlng.latitude,
    Latitude_Longitude__longitude__s: location?.latlng.longitude,
    Phone: resident.phone,
    Spotio_ID__c: account.data.id,
    Lead_Type__c: leadType ?? 'Solar',
    Lead_Setter__c: account.data.owner ? `${account.data.owner.firstName} ${account.data.owner.lastName}` : undefined,
    Closer__c: account.data.closer ? `${account.data.closer.firstName} ${account.data.closer.lastName}` : undefined,
  }
}
