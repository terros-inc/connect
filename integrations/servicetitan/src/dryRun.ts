import type { CustomFieldId } from '@terros-inc/sdk'
import type { Ports } from './sync.ts'

type CustomerEcho = {
  locationId: number
  locationName: unknown
  locationAddress: unknown
  locationCustomFields: unknown
  locationContacts: unknown
}

// Wraps the ServiceTitan fetcher and the Terros write ports for one run.
// GETs are sent, except a locations read for a customer id this run just synthesized: that returns a page so the
// empty-location retry does not spend the budget. POST, PATCH and PUT to the API are not sent. The OAuth token POST
// is sent and not logged; its body contains the client secret.
export function installDryRun(input: {
  fetcher: typeof fetch
  ports: Ports
  eventId: string
  accountId: string
  jobFieldId: CustomFieldId
}): { fetcher: typeof fetch; ports: Ports } {
  let nextId = 0
  const allocate = (): number => {
    nextId -= 1
    return nextId
  }
  const customers = new Map<number, CustomerEcho>()
  const { eventId, accountId, ports } = input
  const log = (message: string): void => {
    ports.log('info', message)
  }
  const line = (rest: string, ids: { eventId?: string; accountId?: string } = {}): string =>
    `SERVICETITAN_DRY_RUN event=${ids.eventId ?? eventId} account=${ids.accountId ?? accountId} ${rest}`

  const fetcher: typeof fetch = async (request, init) => {
    const url = new URL(String(request))
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET') {
      const page = syntheticLocationPage(url, customers)
      if (page) return Response.json(page)
      return input.fetcher(request, init)
    }
    // Only API mutations are held back. The token request is a POST to the auth host and must go out so reads work.
    if (url.hostname !== 'api.servicetitan.io' || (method !== 'POST' && method !== 'PATCH' && method !== 'PUT')) {
      return input.fetcher(request, init)
    }
    const body = parseJsonBody(init)
    const path = `${url.pathname}${url.search}`
    log(line(`method=${method} path=${path} body=${normalizeJson(body)}`))
    return Response.json(syntheticMutation(method, url, body, allocate, customers))
  }

  return {
    fetcher,
    ports: {
      ...ports,
      writeAccountCustomField: async (writtenAccountId, fields) => {
        log(line(`terros=accountCustomField value=${shown(fields[input.jobFieldId])}`, { accountId: writtenAccountId }))
      },
      writeEventSourceId: async (writtenEventId, sourceId) => {
        log(line(`terros=eventSourceId value=${shown(sourceId)}`, { eventId: writtenEventId }))
      },
      // "created" here is the synthetic id the rest of the run used, not a record ServiceTitan stored.
      log: (level, message) => {
        const created = /^ServiceTitan (customer|job) created: (-?\d+)$/.exec(message)
        const kind = created?.[1]
        const syntheticId = created?.[2]
        if (!kind || !syntheticId) {
          ports.log(level, message)
          return
        }
        log(line(`note=synthetic-${kind} id=${syntheticId}`))
      },
    },
  }
}

function shown(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function parseJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') return null
  try {
    return JSON.parse(init.body)
  } catch {
    return null
  }
}

function normalizeJson(value: unknown): string {
  return JSON.stringify(canonicalize(value ?? null))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function syntheticLocationPage(url: URL, customers: Map<number, CustomerEcho>): Record<string, unknown> | undefined {
  if (url.hostname !== 'api.servicetitan.io' || !url.pathname.endsWith('/locations')) return undefined
  const customerId = Number(url.searchParams.get('customerId'))
  const customer = customers.get(customerId)
  if (!customer) return undefined
  const now = new Date().toISOString()
  return {
    page: 1,
    pageSize: 50,
    hasMore: false,
    totalCount: 1,
    data: [
      {
        id: customer.locationId,
        customerId,
        active: true,
        name: customer.locationName,
        address: customer.locationAddress,
        contacts: customer.locationContacts,
        customFields: customer.locationCustomFields,
        createdOn: now,
        modifiedOn: now,
      },
    ],
  }
}

function syntheticMutation(
  method: string,
  url: URL,
  body: unknown,
  allocate: () => number,
  customers: Map<number, CustomerEcho>
): Record<string, unknown> {
  const request = asRecord(body)
  const now = new Date().toISOString()
  if (method === 'POST' && url.pathname.endsWith('/customers'))
    return syntheticCustomer(request, allocate, customers, now)
  if (method === 'POST' && url.pathname.endsWith('/jobs')) return syntheticJob(request, allocate, now)
  if (method === 'PATCH' && url.pathname.includes('/appointments/')) {
    return {
      id: pathId(url, 'appointments', allocate),
      start: request.start,
      end: request.end,
      arrivalWindowStart: request.start,
      arrivalWindowEnd: request.end,
      status: 'Scheduled',
      createdOn: now,
      modifiedOn: now,
    }
  }
  if (method === 'PATCH' && url.pathname.includes('/jobs/')) {
    return {
      ...syntheticJobShell(pathId(url, 'jobs', allocate), now, allocate, 'Scheduled'),
      campaignId: request.campaignId,
      customFields: request.customFields ?? [],
    }
  }
  if (method === 'PUT' && url.pathname.endsWith('/cancel')) {
    return syntheticJobShell(pathId(url, 'jobs', allocate), now, allocate, 'Canceled')
  }
  return { id: allocate(), createdOn: now, modifiedOn: now }
}

function syntheticCustomer(
  request: Record<string, unknown>,
  allocate: () => number,
  customers: Map<number, CustomerEcho>,
  now: string
): Record<string, unknown> {
  const customerId = allocate()
  const locationId = allocate()
  const locations = Array.isArray(request.locations) ? request.locations : []
  const location = asRecord(locations[0])
  const address = request.address ?? emptyAddress()
  const contacts = request.contacts ?? []
  const customFields = request.customFields ?? []
  customers.set(customerId, {
    locationId,
    locationName: location.name ?? request.name,
    locationAddress: location.address ?? address,
    locationCustomFields: location.customFields ?? [],
    locationContacts: location.contacts ?? contacts,
  })
  return {
    id: customerId,
    active: true,
    name: request.name,
    type: request.type ?? 'Residential',
    address,
    contacts,
    customFields,
    balance: 0,
    doNotMail: false,
    doNotService: false,
    mergedToId: null,
    tagTypeIds: [],
    createdOn: now,
    modifiedOn: now,
    locations: [
      {
        id: locationId,
        customerId,
        active: true,
        name: location.name ?? request.name,
        address: location.address ?? address,
        contacts: location.contacts ?? contacts,
        customFields: location.customFields ?? [],
        createdOn: now,
        modifiedOn: now,
      },
    ],
  }
}

function syntheticJob(request: Record<string, unknown>, allocate: () => number, now: string): Record<string, unknown> {
  const jobId = allocate()
  const appointments = Array.isArray(request.appointments) ? request.appointments : []
  const appointmentIds = appointments.length > 0 ? appointments.map(() => allocate()) : [allocate()]
  const firstAppointmentId = appointmentIds[0] ?? allocate()
  const lastAppointmentId = appointmentIds[appointmentIds.length - 1] ?? firstAppointmentId
  return {
    id: jobId,
    jobNumber: String(jobId),
    jobStatus: 'Scheduled',
    priority: request.priority ?? 'Normal',
    customerId: request.customerId,
    locationId: request.locationId,
    businessUnitId: request.businessUnitId,
    jobTypeId: request.jobTypeId,
    campaignId: request.campaignId,
    customFields: request.customFields ?? [],
    appointmentCount: appointmentIds.length,
    firstAppointmentId,
    lastAppointmentId,
    noCharge: false,
    notificationsEnabled: false,
    createdOn: now,
    modifiedOn: now,
    appointments: appointments.map((appointment, index) => ({
      ...asRecord(appointment),
      id: appointmentIds[index] ?? allocate(),
      status: 'Scheduled',
      createdOn: now,
      modifiedOn: now,
    })),
  }
}

function syntheticJobShell(
  jobId: number,
  now: string,
  allocate: () => number,
  jobStatus: string
): Record<string, unknown> {
  const appointmentId = allocate()
  return {
    id: jobId,
    jobNumber: String(jobId),
    jobStatus,
    priority: 'Normal',
    appointmentCount: 1,
    firstAppointmentId: appointmentId,
    lastAppointmentId: appointmentId,
    createdOn: now,
    modifiedOn: now,
  }
}

function pathId(url: URL, resource: string, allocate: () => number): number {
  const parts = url.pathname.split('/')
  const index = parts.lastIndexOf(resource)
  const raw = index >= 0 ? parts[index + 1] : undefined
  const value = raw === undefined ? Number.NaN : Number(raw)
  return Number.isInteger(value) ? value : allocate()
}

function emptyAddress(): Record<string, string> {
  return { street: '', city: '', state: '', zip: '', country: 'USA' }
}
