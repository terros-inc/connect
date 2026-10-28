import type { AccountWebhookData, LatLng } from '@terros-inc/sdk'
import { findFirstMappedValue, maskEmail, normalizeEmail, removeUndefinedValues } from './util.ts'

export type JobNimbusScriptConfig = {
  defaultCompanyName?: string
  defaultStatus?: string
  jobNimbusRecord?: string
  requiredFields?: string
  statusFields?: Record<string, string>
  statusValues?: Record<string, string>
  workflowType?: string
}

export function toJobNimbusRecord(
  account: AccountWebhookData,
  salesRepId: string,
  scriptConfig: JobNimbusScriptConfig,
  jobNimbusRecord: string
): Record<string, unknown> {
  if (jobNimbusRecord === 'contact') return toJobNimbusContact(account, salesRepId, scriptConfig)

  return toJobNimbusJob(account, salesRepId, scriptConfig)
}

function toJobNimbusContact(
  account: AccountWebhookData,
  salesRepId: string,
  scriptConfig: JobNimbusScriptConfig
): Record<string, unknown> {
  const resident = (account.resident || {}) as Record<string, string | undefined>
  const address = account.address
  const firstName = resident.firstName || ''
  const lastName = resident.lastName || ''
  return removeUndefinedValues({
    first_name: firstName,
    last_name: lastName,
    display_name: `${firstName} ${lastName}`.trim(),
    company: resident.businessName || scriptConfig.defaultCompanyName || '',
    external_id: account.id,
    email: resident.email,
    home_phone: resident.phone,
    address_line1: address?.line1,
    address_line2: address?.line2,
    city: address?.locality,
    state_text: address?.countrySubd,
    zip: address?.postal1,
    geo: toJobNimbusGeo(address?.latlng),
    sales_rep: salesRepId,
  })
}

function toJobNimbusJob(
  account: AccountWebhookData,
  salesRepId: string,
  scriptConfig: JobNimbusScriptConfig
): Record<string, unknown> {
  const resident = (account.resident || {}) as Record<string, string | undefined>
  const address = account.address
  const firstName = resident.firstName || ''
  const lastName = resident.lastName || ''
  const displayName = `${firstName} ${lastName}`.trim()
  return removeUndefinedValues({
    name: displayName || resident.businessName || `Terros Account ${account.id}`,
    description: account.notes?.[0]?.text,
    external_id: account.id,
    address_line1: address?.line1,
    address_line2: address?.line2,
    city: address?.locality,
    state_text: address?.countrySubd,
    zip: address?.postal1,
    geo: toJobNimbusGeo(address?.latlng),
    sales_rep: salesRepId,
  })
}

export function getStatusName(account: AccountWebhookData, scriptConfig: JobNimbusScriptConfig): string | undefined {
  const statusFields = scriptConfig.statusFields ?? {}
  const statusValues = scriptConfig.statusValues ?? {}
  const statusName = findFirstMappedValue(account as Record<string, unknown>, statusFields, statusValues)
  if (statusName) return statusName

  return scriptConfig.defaultStatus || undefined
}

export function getCreateSkipReason(
  account: AccountWebhookData,
  scriptConfig: JobNimbusScriptConfig
): string | undefined {
  if (!getStatusName(account, scriptConfig)) return 'no JobNimbus status mapped for its stage'

  const missing = findMissingRequiredFields(account, scriptConfig.requiredFields)
  if (missing.length > 0) return `missing required ${missing.join(', ')}`

  return undefined
}

// Only a new record gets a status: once it exists, JobNimbus owns the status and type, so updates leave them alone.
export function toNewJobNimbusRecord(
  record: Record<string, unknown>,
  statusName: string,
  scriptConfig: JobNimbusScriptConfig
): Record<string, unknown> {
  return { ...record, record_type_name: scriptConfig.workflowType || 'Customer', status_name: statusName }
}

function findMissingRequiredFields(account: AccountWebhookData, requiredFields: string | undefined): string[] {
  const resident = (account.resident || {}) as Record<string, unknown>
  return (requiredFields || '')
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field && !String(resident[field] ?? '').trim())
}

function toJobNimbusGeo(latlng: LatLng | undefined): { lat: number; lon: number } | undefined {
  if (!latlng) return undefined
  if (typeof latlng.latitude !== 'number' || typeof latlng.longitude !== 'number') return undefined

  return {
    lat: latlng.latitude,
    lon: latlng.longitude,
  }
}

// The documented JobNimbus API, https://documenter.getpostman.com/view/3919598/S11PpG4x. Every call
// authenticates with the install's own API key.
const baseUrl: string = 'https://app.jobnimbus.com/api1'

// JobNimbus publishes no rate limits, so there is no client-side limiter: a 429 is retried a bounded number of
// times, after Retry-After when JobNimbus sends it and otherwise after a doubling wait.
const maxAttempts = 3
const firstRetryWaitMs = 1000
const maxRetryWaitMs = 5000

export type JobNimbusRecord = {
  jnid?: string
  external_id?: string
  name?: string
  status_name?: string
  date_status_change?: number
  address_line1?: string
  city?: string
  state_text?: string
  zip?: string
  owners?: { id?: string }[]
  sales_rep?: string
}
export type JobNimbusUser = { id: string; email?: string }

export class JobNimbusError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

type ClientOptions = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class JobNimbusClient {
  private readonly fetch: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly apiKey: string,
    options: ClientOptions = {}
  ) {
    this.fetch = options.fetch ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  // Undefined when this key cannot read the job: a made-up jnid, a deleted job, or another JobNimbus account's job.
  async getJob(jnid: string): Promise<JobNimbusRecord | undefined> {
    try {
      return (await this.request('GET', `/jobs/${encodeURIComponent(jnid)}`)) as JobNimbusRecord
    } catch (error) {
      if (error instanceof JobNimbusError && error.status === 404) return undefined
      throw error
    }
  }

  // The record Send created for a Terros account earlier, found by the account ID it writes into external_id.
  async findByExternalId(path: 'jobs' | 'contacts', externalId: string): Promise<JobNimbusRecord | undefined> {
    const filter = JSON.stringify({ must: [{ term: { external_id: externalId } }] })
    const result = (await this.request('GET', `/${path}?${new URLSearchParams({ filter, size: '10' })}`)) as {
      results?: JobNimbusRecord[]
    }
    return result?.results?.find((record) => record.jnid && record.external_id === externalId)
  }

  create(path: 'jobs' | 'contacts', record: Record<string, unknown>): Promise<JobNimbusRecord> {
    return this.request('POST', `/${path}`, record) as Promise<JobNimbusRecord>
  }

  update(path: 'jobs' | 'contacts', jnid: string, record: Record<string, unknown>): Promise<JobNimbusRecord> {
    return this.request('PUT', `/${path}/${encodeURIComponent(jnid)}`, record) as Promise<JobNimbusRecord>
  }

  async findUser(match: { id?: string; email?: string }): Promise<JobNimbusUser | undefined> {
    if (!match.id && !match.email) return undefined
    const result = (await this.request('GET', '/account/users')) as { users?: JobNimbusUser[] }
    const user = (result?.users ?? []).find((user) =>
      match.id ? user.id === match.id : normalizeEmail(user.email) === normalizeEmail(match.email)
    )
    if (!user) console.log(`No JobNimbus user matched ${match.id ?? maskEmail(match.email)}`)
    return user
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      if (response.status === 429 && attempt < maxAttempts) {
        const waitMs = getRetryWaitMs(response.headers, attempt)
        console.log(`JobNimbus ${method} ${path} was rate limited; retrying in ${waitMs}ms`)
        await this.sleep(waitMs)
        continue
      }

      if (response.status === 401 || response.status === 403) {
        // JobNimbus keys expire one year after they are created, and keys created before Sep 18, 2026 ("legacy"
        // keys) expire too, so a key that worked for months starts failing here. Say so instead of a bare status.
        throw new JobNimbusError(
          `JobNimbus rejected this install's API key (${response.status}) on ${method} ${path}: the key is invalid, ` +
            `expired or lacks access. Create a new key in JobNimbus (Settings > API) and update the apiKey secret.`,
          response.status
        )
      }

      if (!response.ok) {
        const text = await response.text()
        throw new JobNimbusError(
          `JobNimbus ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`,
          response.status
        )
      }

      const text = await response.text()
      return text ? JSON.parse(text) : undefined
    }
  }
}

function getRetryWaitMs(headers: Headers, attempt: number): number {
  const seconds = Number(headers.get('Retry-After'))
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, maxRetryWaitMs)
  return Math.min(firstRetryWaitMs * 2 ** (attempt - 1), maxRetryWaitMs)
}
