import type { AccountWebhookData } from '@terros-inc/sdk'
import type { AccuLynxJob } from './acculynx.ts'

export type AccuLynxRecordType = 'contact' | 'job'

export type AccuLynxSendConfig = {
  recordType?: string
  contactTypeId?: string
  leadSourceId?: string
  accountFilterField?: string
  accountFilterValues?: string
  addressCountry?: string
}

// Neither record type is a default: the install must say which one it sends.
export function getRecordType(value: string | undefined): AccuLynxRecordType {
  const recordType = String(value || '')
    .trim()
    .toLowerCase()
  if (recordType === 'contact' || recordType === 'job') return recordType
  throw Error(`recordType must be 'contact' or 'job', got "${value ?? ''}"`)
}

// One install per AccuLynx location. When a customer has several locations, each install sends only the accounts
// whose accountFilterField value is listed in accountFilterValues. With no filter the install sends every account.
export function matchesAccountFilter(account: AccountWebhookData, config: AccuLynxSendConfig): boolean {
  const field = config.accountFilterField?.trim()
  if (!field) return true

  const allowed = splitList(config.accountFilterValues)
  const value = getPathValue(account as Record<string, unknown>, field)
  return value !== undefined && value !== null && allowed.includes(String(value))
}

export function toAccuLynxContact(account: AccountWebhookData, config: AccuLynxSendConfig): Record<string, unknown> {
  const resident = account.resident || {}
  const address = account.address
  const phone = toAccuLynxPhone(resident.phone)

  return removeEmpty({
    firstName: resident.firstName,
    lastName: resident.lastName,
    companyName: resident.businessName,
    crossReference: account.id,
    contactTypeIds: config.contactTypeId ? [config.contactTypeId] : undefined,
    phoneNumbers: phone ? [{ number: phone, type: 'Home', primary: true }] : undefined,
    emailAddresses: resident.email ? [{ address: resident.email, type: 'Personal', primary: true }] : undefined,
    // A contact's state and country are AccuLynx numeric IDs, which the account does not carry, so they are left out.
    mailingAddress: address?.line1
      ? removeEmpty({
          street1: address.line1,
          street2: address.line2,
          city: address.locality,
          zipCode: address.postal1,
        })
      : undefined,
  })
}

export function toAccuLynxJob(
  account: AccountWebhookData,
  contactId: string,
  config: AccuLynxSendConfig
): Record<string, unknown> {
  const address = account.address
  const country = getAddressCountry(config.addressCountry)
  const hasFullAddress = address?.line1 && address.locality && address.countrySubd && address.postal1 && country

  return removeEmpty({
    contact: { id: contactId },
    leadSource: config.leadSourceId ? { id: config.leadSourceId } : undefined,
    // AccuLynx requires street, city, state, country and ZIP together. Terros addresses carry no country, so the
    // address is sent only when the install names its country.
    locationAddress: hasFullAddress
      ? removeEmpty({
          street1: address.line1,
          street2: address.line2,
          city: address.locality,
          state: address.countrySubd,
          country,
          zipCode: address.postal1,
        })
      : undefined,
    notes: account.notes?.[0]?.text?.slice(0, 1000),
  })
}

// An ISO 3166-1 alpha-2 code such as US or CA, or undefined when the install sets none.
export function getAddressCountry(value: string | undefined): string | undefined {
  const country = String(value || '')
    .trim()
    .toUpperCase()
  if (!country) return undefined
  if (!/^[A-Z]{2}$/.test(country)) throw Error(`addressCountry must be a two-letter country code, got "${value}"`)
  return country
}

// One name field of the contact, to narrow the search for a contact an earlier attempt created.
export function getContactSearchTerm(contact: Record<string, unknown>): string | undefined {
  const term = contact.lastName || contact.firstName || contact.companyName
  return typeof term === 'string' ? term : undefined
}

// The contact cannot predate its account. A day of slack covers clock and time zone differences.
export function getContactSearchStart(account: AccountWebhookData): number {
  const createdAt = Date.parse(String(account.createdAt ?? ''))
  return Number.isFinite(createdAt) ? Math.max(createdAt - 24 * 60 * 60 * 1000, 0) : 0
}

// AccuLynx accepts exactly 10 digits. A US number with a leading country code 1 is shortened; anything else is dropped.
export function toAccuLynxPhone(phone: unknown): string | undefined {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return undefined
}

export const milestoneChangedTopic = 'job.milestone.current_changed'

export type MilestoneChange = {
  subscriptionId?: string
  jobId: string
}

// Reads a job.milestone.current_changed webhook. Returns undefined for any other topic. AccuLynx does not sign
// webhooks, so only the job ID is taken from the body; the milestone itself is read back from AccuLynx.
export function parseMilestoneChange(body: unknown): MilestoneChange | undefined {
  const payload = (body || {}) as {
    topicName?: string
    subscriptionId?: string
    event?: { job?: { id?: string } }
  }
  if (payload.topicName !== milestoneChangedTopic) return undefined

  const jobId = payload.event?.job?.id
  if (!jobId) throw Error('AccuLynx milestone webhook has no job id')

  return { subscriptionId: payload.subscriptionId, jobId }
}

// The Terros account fields that a job fetched from AccuLynx can fill in when the webhook creates an account.
export function fromAccuLynxJob(job: AccuLynxJob | undefined): Record<string, unknown> {
  if (!job) return {}

  const contact = (job.contacts?.find((item) => item.isPrimary) ?? job.contacts?.[0])?.contact
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.companyName
  const address = job.locationAddress

  return removeEmpty({
    resident: name ? { name } : undefined,
    location: address?.street1
      ? removeEmpty({
          line1: address.street1,
          line2: address.street2,
          locality: address.city,
          countrySubd: address.state?.abbreviation,
          postal1: address.zipCode,
        })
      : undefined,
  })
}

export function splitList(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, source)
}

function removeEmpty(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''))
}
