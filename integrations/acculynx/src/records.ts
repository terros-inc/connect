import type { AccountWebhookData } from '@terros-inc/sdk'
import type { AccuLynxJob } from './acculynx.ts'

export type AccuLynxRecordType = 'contact' | 'job'

export type AccuLynxSendConfig = {
  recordType?: string
  contactTypeId?: string
  leadSourceId?: string
  accountFilterField?: string
  accountFilterValues?: string
  triggerStages?: string
  addressCountry?: string
  testMode?: string
}

const offSwitchValues = ['', 'false', 'no', 'off', '0']
const onSwitchValues = ['true', 'yes', 'on', '1']
const teamFilterFields = new Set(['owner.teamIds', 'owner.memberOf', 'teamId', 'team'])
const unassignedTeamId = 'Team.unassigned'

// Unknown values fail safe: a misspelled test-mode value must never enable writes.
export function isTestModeOn(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value
  const text = (value ?? '').trim().toLowerCase()
  if (offSwitchValues.includes(text)) return false
  if (!onSwitchValues.includes(text)) {
    console.error(`Config testMode is "${value}", expected true or false; treating it as true`)
  }
  return true
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
export function matchesAccountFilter(
  account: AccountWebhookData,
  config: AccuLynxSendConfig,
  diagnostics = false
): boolean {
  const field = config.accountFilterField?.trim()
  if (!field) return true

  const allowed = splitList(config.accountFilterValues)
  if (teamFilterFields.has(field)) {
    const accountTeamId = account.teamId?.trim()
    if (accountTeamId && accountTeamId !== unassignedTeamId) {
      const matches = allowed.includes(accountTeamId)
      if (diagnostics) logTeamFilterDecision('account team', [accountTeamId], matches)
      return matches
    }

    const candidates = getFilterValues(getPathValue(account as Record<string, unknown>, field)).filter(
      (candidate) => candidate !== unassignedTeamId
    )
    const matches = candidates.some((candidate) => allowed.includes(candidate))
    if (diagnostics) {
      const path = field.startsWith('owner.') ? `owner teams from ${field}` : `configured ${field} fallback`
      logTeamFilterDecision(path, candidates, matches)
    }
    return matches
  }

  const value = getPathValue(account as Record<string, unknown>, field)
  if (!Array.isArray(value)) return value !== undefined && value !== null && allowed.includes(String(value))

  return value.some((item) => getListFilterValues(item).some((candidate) => allowed.includes(candidate)))
}

export function matchesTriggerStage(account: AccountWebhookData, config: AccuLynxSendConfig): boolean {
  const stages = splitList(config.triggerStages).map(normalizeName)
  if (stages.length === 0) return true
  return stages.includes(normalizeName(account.workflowState?.stageName))
}

export function toAccuLynxContact(account: AccountWebhookData, contactTypeId: string): Record<string, unknown> {
  const resident = account.resident || {}
  const address = account.address
  const phone = toAccuLynxPhone(resident.phone)

  return removeEmpty({
    firstName: resident.firstName,
    lastName: resident.lastName,
    companyName: resident.businessName,
    crossReference: account.id,
    contactTypeIds: [contactTypeId],
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
  const country = getAddressCountry(address?.country, config.addressCountry)
  const hasFullAddress = address?.line1 && address.locality && address.countrySubd && address.postal1 && country

  return removeEmpty({
    contact: { id: contactId },
    leadSource: config.leadSourceId ? { id: config.leadSourceId } : undefined,
    // AccuLynx requires street, city, state, country and ZIP together. Older Account webhooks omitted country, so
    // the install setting remains the fallback when the webhook does not carry a valid code.
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

// Prefer a valid webhook code; older Account webhooks need the configured fallback.
export function getAddressCountry(
  webhookValue: string | undefined,
  fallbackValue: string | undefined
): string | undefined {
  const webhookCountry = String(webhookValue || '')
    .trim()
    .toUpperCase()
  if (/^[A-Z]{2}$/.test(webhookCountry)) return webhookCountry

  const country = String(fallbackValue || '')
    .trim()
    .toUpperCase()
  if (!country) return undefined
  if (!/^[A-Z]{2}$/.test(country)) {
    throw Error(`addressCountry must be a two-letter country code, got "${fallbackValue}"`)
  }
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

function getListFilterValues(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object') return [String(value)]

  const item = value as Record<string, unknown>
  return [item.teamId, item.name].filter((candidate) => candidate !== undefined && candidate !== null).map(String)
}

function getFilterValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap(getListFilterValues)
}

function logTeamFilterDecision(path: string, candidates: string[], matches: boolean): void {
  console.log(
    `TEST MODE: account filter used ${path}; ${candidates.length ? `team=${JSON.stringify(candidates)}` : 'no team value'}; ` +
      `${matches ? 'matched' : 'rejected by'} this install's values`
  )
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
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
