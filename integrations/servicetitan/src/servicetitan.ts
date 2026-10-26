import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Secrets } from './config.ts'

const id = z.number().int().positive()
const customField = z.object({ typeId: z.number().nullish(), value: z.string().nullish() })
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'expected a date-time')
const customerSchema = z.object({ id, customFields: z.array(customField).nullish() })
const technicianSchema = z.object({
  id,
  name: z.string(),
  team: z.string().nullish(),
  businessUnitId: id.nullish(),
})
const appointmentSchema = z.object({ id, start: instant, end: instant })
const assignmentSchema = z.object({ appointmentId: id, technicianId: id, active: z.boolean() })
const jobSchema = z.object({
  id,
  customerId: id,
  locationId: id,
  campaignId: id,
  lastAppointmentId: id.nullish(),
  customFields: z.array(customField).nullish(),
})
const page = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) })
// Creates are checked for the new ID only, so a successful create is always linked even if other fields change.
const created = z.object({ id })
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() })

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

export type CustomField = z.infer<typeof customField>
export type Customer = z.infer<typeof customerSchema>
export type Technician = z.infer<typeof technicianSchema>
export type Appointment = z.infer<typeof appointmentSchema>
export type Assignment = z.infer<typeof assignmentSchema>
export type Job = z.infer<typeof jobSchema>
export type Address = {
  street: string
  city: string
  state: string
  zip: string
  country: 'USA'
  latitude?: number
  longitude?: number
}
export type Contact = { type: 'Email' | 'Phone'; value: string; memo: string }
export type CustomerInput = {
  name: string
  type: 'Residential'
  address: Address
  contacts: Contact[]
  customFields?: CustomField[]
  locations: { name: string; address: Address; contacts: Contact[]; customFields?: CustomField[] }[]
}
export type JobUpdate = { campaignId: number; customFields: CustomField[] }
export type JobInput = JobUpdate & {
  customerId: number
  locationId: number
  jobTypeId: number
  businessUnitId: number
  priority: 'Normal'
  appointments: { start: string; end: string; technicianIds: number[] }[]
}
// retryable marks failures that may succeed on a later attempt: HTTP 429, 5xx and network errors or timeouts.
export type Result<T> = { ok: true; value: T } | { ok: false; message: string; retryable: boolean }

// The script Lambda and the Connect engine both time out at 60 seconds, and an engine timeout is the one case the
// platform redelivers. A redelivery after a job create but before its link is saved duplicates the job, so each run
// stays well inside that limit.
export const RUN_BUDGET_MS = 45_000
export const REQUEST_TIMEOUT_MS = 10_000
// A retry is skipped unless this much budget would still remain once its delay has passed.
export const RETRY_RESERVE_MS = 15_000
// A create is not started with less than this left: one request timeout plus time to save the links.
export const CREATE_RESERVE_MS = 20_000
const MIN_REQUEST_MS = 1000
const READ_BACKOFF = 3000
const UPDATE_BACKOFF = 5000

export class RunBudget {
  private readonly deadline: number
  constructor(totalMs: number = RUN_BUDGET_MS) {
    this.deadline = Date.now() + totalMs
  }
  remaining(): number {
    return Math.max(0, this.deadline - Date.now())
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
class BudgetExhausted extends Error {}

// Up to three attempts with exponential delay and 0-10% jitter, retrying only retryable failures and only while the
// run budget allows. Only reads and updates use it: a timed-out create may have succeeded, so retrying it can
// duplicate records.
export async function retryWithBackoff<T>(
  fn: () => Promise<Result<T>>,
  backoff: number,
  budget: RunBudget
): Promise<Result<T>> {
  for (let attempt = 1; ; attempt++) {
    const result = await fn()
    if (result.ok || !result.retryable || attempt === 3) return result
    const delay = backoff * 2 ** (attempt - 1)
    const wait = delay + Math.floor(Math.random() * delay * 0.1)
    if (budget.remaining() - wait < RETRY_RESERVE_MS) return result
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

export class ServiceTitanClient {
  private static tokens = new Map<string, { token: string; expiry: number }>()
  private readonly tokenKey: string
  constructor(
    private secrets: Secrets,
    private fetcher: typeof fetch = fetch,
    readonly budget: RunBudget = new RunBudget()
  ) {
    // Installs share the Lambda, so tokens are cached per credential. The secret is hashed into the key so a rotated
    // secret gets a new token; the raw secret is never stored in the key.
    const secretHash = createHash('sha256').update(secrets.clientSecret).digest('hex').slice(0, 16)
    this.tokenKey = `${secrets.clientId}:${secrets.tenantId}:${secretHash}`
  }

  get tenantId(): string {
    return this.secrets.tenantId
  }

  // Each request gets at most REQUEST_TIMEOUT_MS, and never more than the budget left, including reading the body.
  private async request(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
    const timeout = Math.min(REQUEST_TIMEOUT_MS, this.budget.remaining())
    if (timeout < MIN_REQUEST_MS) throw new BudgetExhausted('ServiceTitan run budget exhausted')
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new DOMException('ServiceTitan request timed out', 'TimeoutError')),
      timeout
    )
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal })
      return { status: response.status, text: await response.text() }
    } finally {
      clearTimeout(timer)
    }
  }

  private async token(): Promise<string> {
    const now = Date.now()
    const cached = ServiceTitanClient.tokens.get(this.tokenKey)
    if (cached && cached.expiry > now) return cached.token
    const response = await this.request('https://auth.servicetitan.io/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.secrets.clientId,
        client_secret: this.secrets.clientSecret,
      }),
    })
    if (response.status < 200 || response.status >= 300) {
      throw new HttpError(`ServiceTitan OAuth failed (HTTP ${response.status})`, response.status)
    }
    const data = tokenSchema.safeParse(parseJson(response.text))
    if (!data.success) throw new HttpError('ServiceTitan OAuth response has no access token', 502)
    ServiceTitanClient.tokens.set(this.tokenKey, {
      token: data.data.access_token,
      expiry: now + (data.data.expires_in || 900) * 1000 - 60_000,
    })
    return data.data.access_token
  }

  // One attempt, plus one re-authentication after a 401 (the request was rejected unprocessed, so this is safe for
  // creates too). Never throws; failures and invalid responses come back as values.
  private async send<T>(
    schema: z.ZodType<T>,
    area: string,
    path: string,
    method = 'GET',
    body?: object
  ): Promise<Result<T>> {
    const label = `ServiceTitan ${method} ${area}/${path.split('?')[0]}`
    let text: string
    try {
      for (let reauthorized = false; ; reauthorized = true) {
        const token = await this.token()
        const response = await this.request(
          `https://api.servicetitan.io/${area}/v2/tenant/${this.secrets.tenantId}/${path}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              'ST-App-Key': this.secrets.appKey,
              'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
          }
        )
        if (response.status === 401) {
          ServiceTitanClient.tokens.delete(this.tokenKey)
          if (!reauthorized) continue
        }
        if (response.status < 200 || response.status >= 300) {
          return {
            ok: false,
            message: `${label} failed (HTTP ${response.status})`,
            retryable: isRetryableStatus(response.status),
          }
        }
        text = response.text
        break
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return { ok: false, message: error.message, retryable: isRetryableStatus(error.status) }
      }
      if (error instanceof BudgetExhausted) return { ok: false, message: `${label}: ${error.message}`, retryable: true }
      return { ok: false, message: `${label} failed (network error or timeout)`, retryable: true }
    }
    const parsed = schema.safeParse(parseJson(text))
    if (!parsed.success) return { ok: false, message: `${label} returned an invalid response`, retryable: false }
    return { ok: true, value: parsed.data }
  }

  private read<T>(schema: z.ZodType<T>, area: string, path: string): Promise<Result<T>> {
    return retryWithBackoff(() => this.send(schema, area, path), READ_BACKOFF, this.budget)
  }

  // Update responses are not used, so any successful status counts, including an empty body.
  private update(area: string, path: string, method: string, body: object): Promise<Result<unknown>> {
    return retryWithBackoff(() => this.send(z.unknown(), area, path, method, body), UPDATE_BACKOFF, this.budget)
  }

  searchCustomers(query: Record<string, string | undefined>): Promise<Result<{ data: Customer[] }>> {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1]))
    )
    return this.read(page(customerSchema), 'crm', `customers?${params}`)
  }
  createCustomer(body: CustomerInput): Promise<Result<{ id: number }>> {
    return this.send(created, 'crm', 'customers', 'POST', body)
  }
  // A just-created customer's location can lag, so an empty page is retried like a transient failure.
  getLocation(customerId: number): Promise<Result<{ id: number }>> {
    return retryWithBackoff(
      async () => {
        const result = await this.send(page(z.object({ id })), 'crm', `locations?customerId=${customerId}`)
        if (!result.ok) return result
        const location = result.value.data[0]
        if (!location) return { ok: false, message: 'ServiceTitan location not found', retryable: true }
        return { ok: true, value: location }
      },
      READ_BACKOFF,
      this.budget
    )
  }
  searchTechnicians(query: { ids?: string[]; name?: string }): Promise<Result<{ data: Technician[] }>> {
    const params = new URLSearchParams()
    if (query.ids?.length) params.set('ids', query.ids.join(','))
    else if (query.name) params.set('name', query.name)
    return this.read(page(technicianSchema), 'settings', `technicians?${params}`)
  }
  createJob(body: JobInput): Promise<Result<{ id: number }>> {
    return this.send(created, 'jpm', 'jobs', 'POST', body)
  }
  getJob(jobId: number): Promise<Result<Job>> {
    return this.read(jobSchema, 'jpm', `jobs/${jobId}`)
  }
  updateJob(jobId: number, body: JobUpdate): Promise<Result<unknown>> {
    return this.update('jpm', `jobs/${jobId}`, 'PATCH', body)
  }
  cancelJob(jobId: number, body: { reasonId: number; memo: string }): Promise<Result<unknown>> {
    return this.update('jpm', `jobs/${jobId}/cancel`, 'PUT', body)
  }
  getAppointment(appointmentId: number): Promise<Result<Appointment>> {
    return this.read(appointmentSchema, 'jpm', `appointments/${appointmentId}`)
  }
  updateAppointment(appointmentId: number, body: { start: string; end: string }): Promise<Result<unknown>> {
    return this.update('jpm', `appointments/${appointmentId}/reschedule`, 'PATCH', body)
  }
  searchAppointmentAssignments(ids: number[]): Promise<Result<{ data: Assignment[] }>> {
    return this.read(page(assignmentSchema), 'dispatch', `appointment-assignments?appointmentIds=${ids.join(',')}`)
  }
}
