import {
  type AccountWebhook,
  type AccountWebhookData,
  type AccountUpsertInput,
  PermanentError,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { MIRROR_SOURCE, targetClient } from './target.ts'

type Resident = { firstName?: string; lastName?: string; email?: string; phone?: string; businessName?: string }

export const handler = wrapConnectHandler<AccountWebhook>(async (input) => {
  const { payload, config } = input.context
  if (payload.action !== 'add') return

  const { account } = await targetClient(config.secrets).account.upsert(toTargetAccount(payload.data))
  // With no sourceId match, upsert falls back to an address match. When the target company denies duplicate
  // accounts and one already sits at this address, it succeeds without saving anything; a retry would do the same.
  if (!account) throw new PermanentError(`The target company did not save account ${payload.data.id}`)
  console.log(`Copied account ${payload.data.id} to target account ${account.accountId}`)
})

/**
 * The source account ID becomes the target's `sourceId`. `account/upsert` matches an existing account by `sourceId`
 * before it creates one, so a repeated event updates the copy instead of making a second account.
 * Owner, closer, workflow and custom fields stay behind: their IDs only mean something in the source company.
 */
function toTargetAccount(data: AccountWebhookData): AccountUpsertInput {
  const resident = (data.resident ?? {}) as Resident
  const address = data.address
  return {
    account: {
      sourceId: data.id,
      accountSource: MIRROR_SOURCE,
      resident: {
        firstName: resident.firstName,
        lastName: resident.lastName,
        email: resident.email,
        phone: resident.phone,
        businessName: resident.businessName,
      },
      location: address && {
        line1: address.line1,
        line2: address.line2,
        locality: address.locality,
        countrySubd: address.countrySubd,
        postal1: address.postal1,
        unitNbr: address.unitNbr,
        latlng: address.latlng,
      },
    },
  }
}
