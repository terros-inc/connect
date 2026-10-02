import { type AccountData, type TerrosClient } from '@terros-inc/sdk'
import { ghlApi, isNotFound } from './util.ts'
import { toContact } from './gohighlevel.ts'

type GoHighLevelContact = {
  id: string
  locationId?: string
}

// A contact id saved by another location or since deleted is not usable; the caller relinks via upsert.
export async function findValidContactId(
  accessToken: string,
  locationId: string,
  externalLeadId: string | undefined
): Promise<string | undefined> {
  if (!externalLeadId) return

  try {
    const { contact } = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, `/contacts/${externalLeadId}`)
    if (contact.locationId === locationId) return externalLeadId
    console.log(`Contact ${externalLeadId} belongs to location ${contact.locationId}, relinking`)
  } catch (error) {
    if (!isNotFound(error)) throw error
    console.log(`Contact ${externalLeadId} was not found, relinking`)
  }
}

/**
 * The account's GoHighLevel contact: the linked one when it is valid, otherwise an upsert (GoHighLevel matches an
 * existing contact by email or phone) whose id is saved on the account. Shared by Appointment Sync and GoHighLevel
 * Resync, so a contact is created the same way from either.
 */
export async function ensureContactId(
  client: TerrosClient,
  accessToken: string,
  config: { locationId: string; contactFieldMappings?: Record<string, string> },
  account: Pick<AccountData, 'accountId' | 'externalLeadId' | 'location' | 'resident' | 'customFields'>,
  assignedTo: string | undefined
): Promise<string> {
  const existing = await findValidContactId(accessToken, config.locationId, account.externalLeadId)
  if (existing) return existing

  const contactInput = toContact(
    { address: account.location, resident: account.resident, customFieldMap: account.customFields },
    config.locationId,
    config.contactFieldMappings,
    assignedTo
  )
  const contactResponse = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, '/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify(contactInput),
  })
  const contactId = contactResponse.contact.id

  await client.account.upsert({
    requestType: 'update',
    account: { accountId: account.accountId, externalLeadId: contactId },
  })
  console.log(`Saved contact ${contactId} to ${account.accountId}`)
  return contactId
}
