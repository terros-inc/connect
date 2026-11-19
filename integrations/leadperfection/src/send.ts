import { DateTime } from 'luxon'
import {
  type AccountWebhook,
  type AccountWebhookData,
  IntegrationError,
  PermanentError,
  type TerrosClient,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { LeadAddUncertainError, type LeadAddRequest, LeadPerfectionClient, readSecrets } from './leadperfection.ts'

export const LEADPERFECTION_SOURCE = 'LeadPerfection'

export type SendConfig = {
  sendStageIds?: string
  srs_id?: string
  sender?: string
  productID?: string
  brn_id?: string
  timeZone?: string
}

export const handler = wrapConnectHandler<AccountWebhook, void, SendConfig>(async (input, client) => {
  const payload = input.context.payload
  if (payload.action === 'remove') {
    console.log('Skipping LeadPerfection send for Account remove')
    return
  }
  const leadPerfection = new LeadPerfectionClient(readSecrets(input.context.config.secrets))
  await sendAccount(payload.data, input.context.config.scriptConfig, leadPerfection, client)
})

// Sends an account to LeadPerfection once, when it is in one of the configured stages, and saves the returned
// inbound lead ID as its externalLeadId. An account with an externalLeadId, or one that came from LeadPerfection,
// is never sent again. LeadPerfection does not dedupe leads, so before LeadAdd the account is claimed with a pending
// externalLeadId that only one delivery can set, and a LeadAdd that may have added the lead is never retried.
export async function sendAccount(
  account: AccountWebhookData,
  config: SendConfig,
  leadPerfection: Pick<LeadPerfectionClient, 'leadAdd'>,
  terros: Pick<TerrosClient, 'account'>
): Promise<void> {
  const stageIds = splitList(config.sendStageIds)
  if (stageIds.length === 0) throw new IntegrationError('sendStageIds is required: the Terros stage IDs that send')
  const srsId = Number(config.srs_id)
  if (!Number.isInteger(srsId) || srsId <= 0) {
    throw new IntegrationError('srs_id is required: the numeric LeadPerfection source sub ID for these leads')
  }

  const stageId = account.workflowState?.stageId
  if (!stageId || !stageIds.includes(stageId)) {
    console.log(`Skipping account ${account.id}: stage ${stageId} is not a send stage`)
    return
  }
  if (account.externalLeadId) {
    console.log(`Skipping account ${account.id}: already sent as LeadPerfection lead ${account.externalLeadId}`)
    return
  }

  // The webhook can be older than the account: a parallel delivery may have linked it since.
  const { account: stored } = await terros.account.get({ accountId: account.id })
  if (stored.externalLeadId) {
    console.log(`Skipping account ${account.id}: already sent as LeadPerfection lead ${stored.externalLeadId}`)
    return
  }
  if (stored.accountSource === LEADPERFECTION_SOURCE) {
    console.log(`Skipping account ${account.id}: it came from LeadPerfection`)
    return
  }

  const lead = toLeadAdd(account, stored.appointmentDate, config, srsId)
  if (!lead) {
    console.log(`Skipping account ${account.id}: the resident needs a first and last name for LeadPerfection`)
    return
  }

  const claim = `${PENDING_PREFIX}${new Date().toISOString()}`
  try {
    await terros.account.update({
      account: { accountId: account.id, externalLeadId: claim },
      onlyIfNoExternalLeadId: true,
    })
  } catch (error) {
    if (!isConflict(error)) throw error
    console.log(`Skipping account ${account.id}: another delivery claimed it first`)
    return
  }

  let leadId: number
  try {
    leadId = await leadPerfection.leadAdd(lead)
  } catch (error) {
    if (error instanceof LeadAddUncertainError) {
      throw new PermanentError(
        `LeadPerfection may have added account ${account.id} as a lead (${error.message}), so it is not sent again ` +
          `and its externalLeadId stays ${claim}. Look for lognumber ${account.id} in LeadPerfection: set the ` +
          'account externalLeadId to that lead ID, or clear it to send the account again.',
        { cause: error }
      )
    }
    await updateAfterClaim(
      terros,
      account.id,
      null,
      `LeadPerfection refused account ${account.id} (${String(error)}), but clearing its pending externalLeadId ` +
        `${claim} failed. Clear it by hand to send the account again.`
    )
    throw error
  }
  console.log(`Sent account ${account.id} to LeadPerfection as inbound lead ${leadId}`)
  await updateAfterClaim(
    terros,
    account.id,
    String(leadId),
    `LeadPerfection lead ${leadId} was created for account ${account.id}, but saving it as the account ` +
      `externalLeadId failed. Replace ${claim} with ${leadId} by hand.`
  )
}

// Marks an account a delivery has claimed but not yet sent. Every other delivery sees an externalLeadId and skips it.
const PENDING_PREFIX = 'pending:'

function isConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'Conflict'
}

// A redelivery would see the claim and skip the account for good, so a failed write is retried here and then
// reported as permanent for someone to fix by hand.
async function updateAfterClaim(
  terros: Pick<TerrosClient, 'account'>,
  accountId: AccountWebhookData['id'],
  externalLeadId: string | null,
  failure: string
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await terros.account.update({ account: { accountId, externalLeadId } })
      return
    } catch (cause) {
      if (attempt === 3) throw new PermanentError(failure, { cause })
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
}

export function toLeadAdd(
  account: AccountWebhookData,
  appointmentDate: number | undefined,
  config: SendConfig,
  srsId: number
): LeadAddRequest | undefined {
  const resident = account.resident ?? {}
  const firstname = text(resident.firstName)
  const lastname = text(resident.lastName)
  if (!firstname || !lastname) return undefined

  const address = account.address
  const clientUserId = account.owner?.clientUserId?.trim()
  return {
    firstname,
    lastname,
    address1: address?.line1 ? toPascalCase(address.line1).slice(0, 40) : undefined,
    city: address?.locality ? toPascalCase(address.locality) : undefined,
    state: toState(address?.countrySubd),
    zip: toZip(address?.postal1),
    phone: text(resident.phone),
    email: text(resident.email),
    user1: account.owner?.email,
    user2: account.closer?.email,
    notes: account.note,
    lognumber: account.id,
    // pro_id is a LeadPerfection employee ID; a Terros external user ID that is not one is left out.
    pro_id: clientUserId && /^\d+$/.test(clientUserId) ? Number(clientUserId) : undefined,
    sender: text(config.sender),
    srs_id: srsId,
    productID: text(config.productID),
    brn_id: text(config.brn_id),
    ...toAppointment(appointmentDate, text(config.timeZone) ?? account.owner?.timeZone),
  }
}

export function toPascalCase(value: string): string {
  return value.toLowerCase().replace(/\b([a-z])/g, (_, char: string) => char.toUpperCase())
}

// LeadPerfection takes a two-letter state or province; cutting a longer name would send a wrong one.
function toState(value: string | undefined): string | undefined {
  const state = value?.trim().toUpperCase()
  return state && /^[A-Z]{2}$/.test(state) ? state : undefined
}

// Five characters for a US ZIP (so ZIP+4 loses its suffix), up to seven for a Canadian postal code.
export function toZip(value: string | undefined): string | undefined {
  const zip = value?.trim()
  if (!zip) return undefined
  return /^\d{5}/.test(zip) ? zip.slice(0, 5) : zip.toUpperCase().slice(0, 7)
}

// LeadPerfection wants both appointment fields or neither, as local wall-clock time.
function toAppointment(
  appointmentDate: number | undefined,
  zone: string | undefined
): Pick<LeadAddRequest, 'apptdate' | 'appttime'> {
  if (!appointmentDate) return {}
  const date = zone ? DateTime.fromMillis(appointmentDate, { zone }) : undefined
  if (!date?.isValid) {
    console.log('Sending no appointment: set timeZone, or give the owner a time zone, to send its local time')
    return {}
  }
  return { apptdate: date.toFormat('MM/dd/yyyy'), appttime: date.toFormat('hh:mma') }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
