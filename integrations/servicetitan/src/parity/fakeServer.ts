import type { ParityFixture } from './types.ts'
import { readBody, sortedQuery, type RawCall } from './normalize.ts'

type AllocateKind = 'customer' | 'location' | 'job' | 'appointment'

type StoredCustomer = { id: number; customFields?: { typeId?: number | null; value?: string | null }[] }
type StoredLocation = { id: number; customerId: number }
type StoredJob = {
  id: number
  customerId: number
  locationId: number
  campaignId: number
  lastAppointmentId?: number
  customFields?: { typeId?: number | null; value?: string | null }[]
}
type StoredAppointment = { id: number; start: string; end: string }
type StoredAssignment = { appointmentId: number; technicianId: number; active: boolean }
type StoredTechnician = { id: number; name: string; team?: string; businessUnitId?: number }

// In-memory ServiceTitan. Response bodies only include the fields the Connect client validates.
// Ids allocated for created rows match the legacy harness order so symbolic names line up.
export class ParityFake {
  readonly calls: RawCall[] = []
  readonly aliases = new Map<number, string>()
  private readonly customers: StoredCustomer[] = []
  private readonly locations: StoredLocation[] = []
  private readonly jobs: StoredJob[] = []
  private readonly appointments: StoredAppointment[] = []
  private readonly assignments: StoredAssignment[] = []
  private readonly technicians: StoredTechnician[] = []
  private readonly faults: { method: string; pathIncludes: string; statuses: number[] }[]
  private readonly seq: Record<AllocateKind, number> = {
    customer: 11000,
    location: 12000,
    job: 13000,
    appointment: 14000,
  }
  private readonly counts: Record<AllocateKind, number> = { customer: 0, location: 0, job: 0, appointment: 0 }

  constructor(fixture: ParityFixture) {
    this.faults = fixture.faults.map((fault) => ({ ...fault, statuses: [...fault.statuses] }))
    for (const customer of fixture.seed.customers) {
      this.customers.push({ id: customer.id, customFields: customer.customFields })
    }
    for (const location of fixture.seed.locations) {
      this.locations.push({ id: location.id, customerId: location.customerId })
    }
    for (const job of fixture.seed.jobs) {
      this.jobs.push({
        id: job.id,
        customerId: job.customerId,
        locationId: job.locationId,
        campaignId: job.campaignId,
        lastAppointmentId: job.lastAppointmentId,
        customFields: job.customFields,
      })
    }
    for (const appointment of fixture.seed.appointments) {
      this.appointments.push({ id: appointment.id, start: appointment.start, end: appointment.end })
    }
    for (const assignment of fixture.seed.assignments) {
      this.assignments.push({
        appointmentId: assignment.appointmentId,
        technicianId: assignment.technicianId,
        active: assignment.active,
      })
    }
    for (const technician of fixture.seed.technicians) {
      const stored: StoredTechnician = { id: technician.id, name: technician.name }
      if (technician.team !== undefined) stored.team = technician.team
      if (technician.businessUnitId !== undefined) stored.businessUnitId = technician.businessUnitId
      this.technicians.push(stored)
    }
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(requestUrl(input))
    const method = init?.method ?? 'GET'
    if (url.host === 'auth.servicetitan.io') return json(200, { access_token: 'example-token', expires_in: 900 })
    const fault = this.takeFault(method, url.pathname)
    if (fault !== undefined) {
      this.record(method, url, init)
      return json(fault, { message: 'forced failure' })
    }
    const result = this.route(method, url, init)
    this.record(method, url, init)
    return result
  }

  private route(method: string, url: URL, init: RequestInit | undefined): Response {
    const path = url.pathname
    if (method === 'GET' && path.endsWith('/technicians')) return json(200, page(this.techniciansFor(url)))
    if (method === 'GET' && path.endsWith('/customers')) return json(200, page(this.customers))
    if (method === 'POST' && path.endsWith('/customers')) return json(200, { id: this.createCustomer(init) })
    if (method === 'GET' && path.endsWith('/locations')) return json(200, page(this.locationsFor(url)))
    if (method === 'POST' && path.endsWith('/jobs')) return json(200, { id: this.createJob(init) })
    const cancel = path.match(/\/jobs\/(\d+)\/cancel$/)
    if (method === 'PUT' && cancel?.[1]) return json(200, {})
    const job = path.match(/\/jobs\/(\d+)$/)
    if (job?.[1] && (method === 'GET' || method === 'PATCH')) return this.readJob(Number(job[1]), method)
    const reschedule = path.match(/\/appointments\/(\d+)\/reschedule$/)
    if (method === 'PATCH' && reschedule?.[1]) return json(200, {})
    const appointment = path.match(/\/appointments\/(\d+)$/)
    if (method === 'GET' && appointment?.[1]) return this.readAppointment(Number(appointment[1]))
    if (method === 'GET' && path.endsWith('/appointment-assignments')) return json(200, page(this.assignmentsFor(url)))
    return json(404, { message: `no route for ${method} ${path}` })
  }

  private createCustomer(init: RequestInit | undefined): number {
    const body = asRecord(readBody(init?.body))
    const id = this.allocate('customer')
    const fields = customFields(body?.customFields)
    this.customers.push({ id, ...(fields ? { customFields: fields } : {}) })
    this.locations.push({ id: this.allocate('location'), customerId: id })
    return id
  }

  private createJob(init: RequestInit | undefined): number {
    const body = asRecord(readBody(init?.body))
    const appointmentId = this.allocate('appointment')
    const jobId = this.allocate('job')
    const fields = customFields(body?.customFields)
    const first = Array.isArray(body?.appointments) ? asRecord(body.appointments[0]) : undefined
    this.jobs.push({
      id: jobId,
      customerId: numberField(body, 'customerId'),
      locationId: numberField(body, 'locationId'),
      campaignId: numberField(body, 'campaignId'),
      lastAppointmentId: appointmentId,
      ...(fields ? { customFields: fields } : {}),
    })
    this.appointments.push({
      id: appointmentId,
      start: typeof first?.start === 'string' ? first.start : '',
      end: typeof first?.end === 'string' ? first.end : '',
    })
    return jobId
  }

  private readJob(id: number, method: string): Response {
    const job = this.jobs.find((item) => item.id === id)
    if (!job) return json(404, { message: 'job not found' })
    if (method === 'PATCH') return json(200, {})
    return json(200, job)
  }

  private readAppointment(id: number): Response {
    const appointment = this.appointments.find((item) => item.id === id)
    if (!appointment) return json(404, { message: 'appointment not found' })
    return json(200, appointment)
  }

  private locationsFor(url: URL): { id: number }[] {
    const customerId = Number(url.searchParams.get('customerId'))
    return this.locations
      .filter((location) => location.customerId === customerId)
      .map((location) => ({ id: location.id }))
  }

  private assignmentsFor(url: URL): StoredAssignment[] {
    const raw = url.searchParams.get('appointmentIds')
    if (!raw) return this.assignments
    const ids = new Set(raw.split(',').map((part) => Number(part)))
    return this.assignments.filter((assignment) => ids.has(assignment.appointmentId))
  }

  private techniciansFor(url: URL): StoredTechnician[] {
    const ids = url.searchParams.get('ids')
    if (ids) {
      const wanted = new Set(ids.split(','))
      return this.technicians.filter((technician) => wanted.has(String(technician.id)))
    }
    const name = url.searchParams.get('name')
    if (!name) return this.technicians
    return this.technicians.filter((technician) => technician.name === name)
  }

  private allocate(kind: AllocateKind): number {
    this.seq[kind] += 1
    this.counts[kind] += 1
    const id = this.seq[kind]
    const label = kind === 'appointment' ? 'appt' : kind
    this.aliases.set(id, `$${label}${this.counts[kind]}`)
    return id
  }

  private takeFault(method: string, path: string): number | undefined {
    const fault = this.faults.find(
      (item) => item.method === method && path.includes(item.pathIncludes) && item.statuses.length > 0
    )
    return fault?.statuses.shift()
  }

  private record(method: string, url: URL, init: RequestInit | undefined): void {
    this.calls.push({ method, path: url.pathname, query: sortedQuery(url), body: readBody(init?.body) })
  }
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function page<T>(data: T[]): { data: T[] } {
  return { data }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function numberField(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' ? value : 0
}

function customFields(value: unknown): { typeId?: number; value?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const fields = value.flatMap((field) => {
    const record = asRecord(field)
    if (!record) return []
    const custom: { typeId?: number; value?: string } = {}
    if (typeof record.typeId === 'number') custom.typeId = record.typeId
    if (typeof record.value === 'string') custom.value = record.value
    return [custom]
  })
  return fields
}
