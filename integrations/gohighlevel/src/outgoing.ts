import {
  type AccountId,
  type CustomFieldMap,
  type SmallAddress,
  type TeamId,
  type TinyResidentData,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { getPrivateIntegrationToken, readTrimmedString, toGoHighLevelCustomFields } from './util.ts'
import {
  findAssignedUserId,
  getContact,
  type GoHighLevelContact,
  type GoHighLevelContactInput,
  updateContact,
  upsertContact,
} from './gohighlevel.ts'

type ScriptConfig = {
  contactFieldMappings?: Record<string, string>
}

type Secrets = {
  privateIntegrationTokens: Record<string, string>
}

type AccountChangeData = {
  id: AccountId
  owner?: {
    email?: string
    teamIds?: TeamId[]
  }
  address?: SmallAddress
  resident?: TinyResidentData
  externalLeadId?: string
  customFieldMap?: CustomFieldMap
}

type AccountChangeWebhook =
  | {
      entity: 'Account'
      action: 'add' | 'update'
      data: AccountChangeData
    }
  | {
      entity: 'Account'
      action: 'remove'
      data: { id: AccountId }
    }

export const handler = wrapConnectHandler<AccountChangeWebhook>(async (input, client) => {
  const payload = input.context.payload
  console.log(`Received account ${payload.action} for ${payload.data.id}`)

  if (payload.action === 'remove') {
    console.log(`Skipping sync for removed Terros account ${payload.data.id}`)
    return
  }

  const teamId = payload.data.owner?.teamIds?.[0]
  if (!teamId) throw Error(`Terros account ${payload.data.id} owner has no teamId`)
  const account = payload.data

  const scriptConfig = input.context.config.scriptConfig as unknown as ScriptConfig
  const { team } = await client.team.get({ teamId })
  const locationId = team.externalId
  if (!locationId) throw Error(`Terros team ${team.teamId} has no location ID`)
  const secrets = input.context.config.secrets as unknown as Secrets
  const accessToken = getPrivateIntegrationToken(secrets, locationId)
  const assignedTo = await findAssignedUserId(accessToken, locationId, account.owner?.email)
  const contactInput = toContactInput(account, locationId, scriptConfig, assignedTo)
  const contact = await syncContact(accessToken, account.externalLeadId, contactInput)

  if (!account.externalLeadId) {
    const { account: updatedAccount } = await client.account.upsert({
      requestType: 'update',
      account: {
        accountId: account.id,
        externalLeadId: contact.id,
      },
    })
    if (updatedAccount?.externalLeadId !== contact.id) {
      throw Error(`Failed to save contact ${contact.id} to ${account.id}`)
    }
    console.log(`Saved contact ${contact.id} to ${account.id}`)
  }
})

async function syncContact(
  accessToken: string,
  contactId: string | undefined,
  contactInput: GoHighLevelContactInput
): Promise<GoHighLevelContact> {
  if (!contactId) return upsertContact(accessToken, contactInput)

  const existingContact = await getContact(accessToken, contactId)
  if (existingContact.locationId !== contactInput.locationId) {
    throw Error(
      `Contact ${contactId} belongs to location ${existingContact.locationId}, expected ${contactInput.locationId}`
    )
  }

  const { locationId: _locationId, ...updatedContact } = contactInput
  return updateContact(accessToken, contactId, updatedContact)
}

function toContactInput(
  account: AccountChangeData,
  locationId: string,
  config: ScriptConfig,
  assignedTo: string | undefined
): GoHighLevelContactInput {
  const goHighLevelCustomFields = toGoHighLevelCustomFields(account, config.contactFieldMappings)

  const contact: GoHighLevelContactInput = {
    locationId,
    firstName: readTrimmedString(account.resident?.firstName),
    lastName: readTrimmedString(account.resident?.lastName),
    name: readTrimmedString(account.resident?.name),
    email: readTrimmedString(account.resident?.email),
    phone: readTrimmedString(account.resident?.phone),
    address1: account.address?.line1,
    city: account.address?.locality,
    state: account.address?.countrySubd,
    postalCode: account.address?.postal1,
    assignedTo,
    source: 'Terros',
    customFields: goHighLevelCustomFields,
  }
  return contact
}
