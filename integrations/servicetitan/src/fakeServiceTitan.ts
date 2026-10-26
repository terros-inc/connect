import {
  ServiceTitanClient,
  type Appointment,
  type Assignment,
  type Customer,
  type CustomerInput,
  type Job,
  type JobInput,
  type Technician,
} from './servicetitan.ts'

export type FakeCall = { url: URL; method: string; headers: Headers; body?: unknown; signal?: AbortSignal | null }
type Reply = { status: number; body?: unknown }

// An in-memory server behind the real client, with optional queued failures for individual requests.
export function fakeServiceTitan() {
  const calls: FakeCall[] = []
  const customers: Customer[] = []
  const locations: { id: number; customerId: number }[] = []
  const technicians: Technician[] = [{ id: 2000, name: 'Example Closer', team: 'Example team', businessUnitId: 3000 }]
  const jobs = new Map<number, Job>()
  const appointments = new Map<number, Appointment>()
  const assignments: Assignment[] = []
  const replies = new Map<string, Reply[]>()
  let nextId = 4000
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body
      ? url.hostname.startsWith('auth.')
        ? String(init.body)
        : JSON.parse(String(init.body))
      : undefined
    calls.push({ url, method, body, headers: new Headers(init?.headers), signal: init?.signal })
    const queued = replies.get(`${method} ${url.pathname}`)?.shift()
    if (queued) return Response.json(queued.body ?? {}, { status: queued.status })
    if (url.hostname === 'auth.servicetitan.io')
      return Response.json({ access_token: 'example-token', expires_in: 900 })
    const path = url.pathname.split('/').slice(5).join('/')
    const parts = path.split('/')
    const id = Number(parts[1])
    const page = (data: unknown[]) => Response.json({ data, page: 1, pageSize: 50, hasMore: false })
    if (path === 'technicians') {
      const ids = url.searchParams.get('ids')?.split(',')
      const name = url.searchParams.get('name')
      return page(technicians.filter((tech) => (ids ? ids.includes(String(tech.id)) : !name || tech.name === name)))
    }
    if (path === 'customers' && method === 'GET') return page(customers)
    if (path === 'customers' && method === 'POST') {
      const request = body as CustomerInput
      const customer = { ...request, id: nextId++ }
      customers.push(customer)
      locations.push({ id: nextId++, customerId: customer.id })
      return Response.json(customer)
    }
    if (path === 'locations')
      return page(locations.filter((location) => String(location.customerId) === url.searchParams.get('customerId')))
    if (path === 'appointment-assignments') {
      const ids = url.searchParams.get('appointmentIds')?.split(',')
      return page(assignments.filter((assignment) => ids?.includes(String(assignment.appointmentId))))
    }
    if (path === 'jobs' && method === 'POST') {
      const request = body as JobInput
      const jobId = nextId++
      const appointmentId = nextId++
      const job = { ...request, id: jobId, lastAppointmentId: appointmentId }
      jobs.set(jobId, job)
      const first = request.appointments[0]!
      appointments.set(appointmentId, { ...first, id: appointmentId })
      assignments.push({ appointmentId, technicianId: first.technicianIds[0]!, active: true })
      return Response.json(job)
    }
    if (parts[0] === 'jobs' && jobs.has(id)) {
      const job = jobs.get(id)!
      if (method === 'PATCH') Object.assign(job, body)
      return Response.json(job)
    }
    if (parts[0] === 'appointments' && appointments.has(id)) {
      const appointment = appointments.get(id)!
      if (method === 'PATCH') Object.assign(appointment, body)
      return Response.json(appointment)
    }
    return Response.json({}, { status: 404 })
  }
  // Each fixture uses its own credentials, avoiding cross-test static token reuse.
  const secrets = {
    appKey: 'example-key',
    clientId: `example-${crypto.randomUUID()}`,
    clientSecret: 'example-secret',
    tenantId: '1000',
  }
  return {
    client: new ServiceTitanClient(secrets, fakeFetch),
    fakeFetch,
    secrets,
    calls,
    customers,
    locations,
    technicians,
    jobs,
    appointments,
    assignments,
    replies,
  }
}
