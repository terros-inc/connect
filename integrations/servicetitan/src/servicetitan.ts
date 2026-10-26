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
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() })

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

const READ_BACKOFF = 3000
const UPDATE_BACKOFF = 5000

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

// Three attempts with exponential delay and 0-10% jitter, retrying only retryable failures.
// Only reads and updates use it: a timed-out create may have succeeded, so retrying it can duplicate records.
export async function retryWithBackoff<T>(fn: () => Promise<Result<T>>, backoff: number): Promise<Result<T>> {
  for (let attempt = 1; ; attempt++) {
    const result = await fn()
    if (result.ok || !result.retryable || attempt === 3) return result
    const delay = backoff * 2 ** (attempt - 1)
    await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * delay * 0.1)))
  }
}

export class ServiceTitanClient {
  private static tokens = new Map<string, { token: string; expiry: number }>()
  constructor(
    private secrets: Secrets,
    private fetcher: typeof fetch = fetch
  ) {}

  get tenantId(): string {
    return this.secrets.tenantId
  }

  // Installs share the Lambda, so tokens are cached per credential: OAuth client and tenant.
  private async token(): Promise<string> {
    const key = `${this.secrets.clientId}:${this.secrets.tenantId}`
    const now = Date.now()
    const cached = ServiceTitanClient.tokens.get(key)
    if (cached && cached.expiry > now) return cached.token
    const response = await this.fetcher('https://auth.servicetitan.io/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.secrets.clientId,
        client_secret: this.secrets.clientSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new HttpError(`ServiceTitan OAuth failed (HTTP ${response.status})`, response.status)
    const data = tokenSchema.safeParse(await response.json())
    if (!data.success) throw new HttpError('ServiceTitan OAuth response has no access token', 502)
    ServiceTitanClient.tokens.set(key, {
      token: data.data.access_token,
      expiry: now + (data.data.expires_in || 900) * 1000 - 60_000,
    })
    return data.data.access_token
  }

  // One attempt. Never throws; failures and invalid responses come back as values.
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
      const token = await this.token()
      const response = await this.fetcher(
        `https://api.servicetitan.io/${area}/v2/tenant/${this.secrets.tenantId}/${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'ST-App-Key': this.secrets.appKey,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        }
      )
      if (!response.ok) {
        return {
          ok: false,
          message: `${label} failed (HTTP ${response.status})`,
          retryable: isRetryableStatus(response.status),
        }
      }
      text = await response.text()
    } catch (error) {
      if (error instanceof HttpError) {
        return { ok: false, message: error.message, retryable: isRetryableStatus(error.status) }
      }
      return { ok: false, message: `${label} failed (network error or timeout)`, retryable: true }
    }
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) return { ok: false, message: `${label} returned an invalid response`, retryable: false }
    return { ok: true, value: parsed.data }
  }

  private read<T>(schema: z.ZodType<T>, area: string, path: string): Promise<Result<T>> {
    return retryWithBackoff(() => this.send(schema, area, path), READ_BACKOFF)
  }

  // Update responses are not used, so any successful status counts, including an empty body.
  private update(area: string, path: string, method: string, body: object): Promise<Result<unknown>> {
    return retryWithBackoff(() => this.send(z.unknown(), area, path, method, body), UPDATE_BACKOFF)
  }

  searchCustomers(query: Record<string, string | undefined>): Promise<Result<{ data: Customer[] }>> {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1]))
    )
    return this.read(page(customerSchema), 'crm', `customers?${params}`)
  }
  createCustomer(body: CustomerInput): Promise<Result<Customer>> {
    return this.send(customerSchema, 'crm', 'customers', 'POST', body)
  }
  // A just-created customer's location can lag, so an empty page is retried like a transient failure.
  getLocation(customerId: number): Promise<Result<{ id: number }>> {
    return retryWithBackoff(async () => {
      const result = await this.send(page(z.object({ id })), 'crm', `locations?customerId=${customerId}`)
      if (!result.ok) return result
      const location = result.value.data[0]
      if (!location) return { ok: false, message: 'ServiceTitan location not found', retryable: true }
      return { ok: true, value: location }
    }, READ_BACKOFF)
  }
  searchTechnicians(query: { ids?: string[]; name?: string }): Promise<Result<{ data: Technician[] }>> {
    const params = new URLSearchParams()
    if (query.ids?.length) params.set('ids', query.ids.join(','))
    else if (query.name) params.set('name', query.name)
    return this.read(page(technicianSchema), 'settings', `technicians?${params}`)
  }
  createJob(body: JobInput): Promise<Result<Job>> {
    return this.send(jobSchema, 'jpm', 'jobs', 'POST', body)
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
