import type { Secrets } from './config.ts'

export type CustomField = { typeId?: number | null; value?: string | null }
export type Customer = { id: number; customFields?: CustomField[] }
export type Technician = { id: number; name: string; team?: string | null; businessUnitId?: number | null }
export type Appointment = { id: number; start: string; end: string }
export type Assignment = { appointmentId: number; technicianId: number; active: boolean }
export type Job = {
  id: number
  customerId: number
  locationId: number
  campaignId: number
  lastAppointmentId?: number
  customFields?: CustomField[]
}
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
export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

// Errors returned by legacy fetch were values: retryWithBackoff only retried thrown errors.
export async function retryWithBackoff<T>(fn: () => Promise<T>, backoff: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === 3) throw error
      const delay = backoff * 2 ** (attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * delay * 0.1)))
    }
  }
}

export class ServiceTitanClient {
  private static tokens = new Map<string, { token: string; expiry: number }>()
  constructor(
    private secrets: Secrets,
    private fetcher: typeof fetch = fetch
  ) {}

  private async token(): Promise<string> {
    const key = `${this.secrets.clientId}:${this.secrets.clientSecret}`
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
    if (!response.ok) throw new Error(`ServiceTitan OAuth failed (HTTP ${response.status})`)
    const data = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) throw new Error('ServiceTitan OAuth response has no access token')
    ServiceTitanClient.tokens.set(key, {
      token: data.access_token,
      expiry: now + (data.expires_in || 900) * 1000 - 60_000,
    })
    return data.access_token
  }

  private async request<T>(area: string, path: string, method = 'GET', body?: object): Promise<Result<T>> {
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
      if (!response.ok)
        return { ok: false, message: `ServiceTitan ${method} ${area} request failed (HTTP ${response.status})` }
      return { ok: true, value: (await response.json()) as T }
    } catch {
      return { ok: false, message: `ServiceTitan ${method} ${area} request failed` }
    }
  }

  private async required<T>(result: Promise<Result<T>>, label: string): Promise<T> {
    const response = await result
    if (!response.ok) throw new Error(`ServiceTitan ${label} not found`)
    return response.value
  }

  searchCustomers(query: Record<string, string | undefined>) {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1]))
    )
    return this.request<{ data: Customer[] }>('crm', `customers?${params}`)
  }
  createCustomer(body: CustomerInput) {
    return this.request<Customer>('crm', 'customers', 'POST', body)
  }
  async getLocation(customerId: number): Promise<{ id: number }> {
    const result = await this.required(
      this.request<{ data: { id: number }[] }>('crm', `locations?customerId=${customerId}`),
      'location'
    )
    if (!result.data[0]) throw new Error('ServiceTitan location not found')
    return result.data[0]
  }
  searchTechnicians(query: { ids?: string[]; name?: string }) {
    const params = new URLSearchParams(
      query.ids?.length ? { ids: query.ids.join(',') } : query.name ? { name: query.name } : {}
    )
    return this.request<{ data: Technician[] }>('settings', `technicians?${params}`)
  }
  createJob(body: JobInput) {
    return this.request<Job>('jpm', 'jobs', 'POST', body)
  }
  getJob(id: number) {
    return this.required(this.request<Job>('jpm', `jobs/${id}`), 'job')
  }
  updateJob(id: number, body: JobUpdate) {
    return this.request<Job>('jpm', `jobs/${id}`, 'PATCH', body)
  }
  cancelJob(id: number, body: { reasonId: number; memo: string }) {
    return this.request<Job>('jpm', `jobs/${id}/cancel`, 'PUT', body)
  }
  getAppointment(id: number) {
    return this.required(this.request<Appointment>('jpm', `appointments/${id}`), 'appointment')
  }
  updateAppointment(id: number, body: { start: string; end: string }) {
    return this.request<Appointment>('jpm', `appointments/${id}/reschedule`, 'PATCH', body)
  }
  searchAppointmentAssignments(ids: number[]) {
    return this.request<{ data: Assignment[] }>('dispatch', `appointment-assignments?appointmentIds=${ids.join(',')}`)
  }
}
