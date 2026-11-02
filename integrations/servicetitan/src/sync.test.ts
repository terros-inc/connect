import {
  determineCampaignId,
  parseJobLink,
  sync,
  type Account,
  type CalendarEventWebhook,
  type EventData,
  type Ports,
} from './sync.ts'
import { fakeServiceTitan } from './fakeServiceTitan.ts'
import { PermanentError } from './errors.ts'
import { parseConfig } from './config.ts'

function fixture(options: { budgetMs?: number } = {}) {
  const fake = fakeServiceTitan(options)
  const config = parseConfig({
    jobTypeId: '1001',
    cancelReasonId: '9001',
    serviceTitanJobId: 'CF.servicetitanjob',
    campaignIdSetterGen: '1002',
    campaignIdCloserGen: '1003',
    campaignIdUnknown: '1004',
    customFieldCustomerId: '1005',
    customFieldLocationId: '1006',
    customFieldSetter: '1007',
    customFieldAppointmentOutcome: '1008',
    teamToBusinessUnitMap: { 'Example team': '3001' },
  })
  const event: EventData = {
    id: 'Event.example',
    eventType: 'Consultation',
    eventDate: '2026-10-26T10:00:00-07:00',
    duration: 60,
    owner: { firstName: 'Example', lastName: 'Setter', closerStatus: 'Needs_Help' },
    attendee: { firstName: 'Example', lastName: 'Closer', clientUserId: '2000' },
    account: { accountId: 'Account.example' },
    status: 'Scheduled',
  }
  const account: Account = {
    accountId: 'Account.example',
    accountSource: 'Terros',
    customFields: { 'CF.example': 'keep' },
    resident: { businessName: 'Acme Solar', email: 'user@example.test' },
    location: {
      line1: '1 Example Street',
      locality: 'Example City',
      countrySubd: ' California ',
      postal1: ' 00000-0000',
    },
  }
  const writes: unknown[] = []
  // Write order relative to ServiceTitan calls, e.g. 'account@3' means after three fake requests.
  const order: string[] = []
  const logs: string[] = []
  const ports: Ports = {
    readAccount: async () => structuredClone(account),
    writeAccountCustomField: async (_id, fieldId, value) => {
      writes.push({ [fieldId]: value })
      order.push(`account@${fake.calls.length}`)
      account.customFields = { ...account.customFields, [fieldId]: value }
    },
    writeEventSourceId: async (_id, value) => {
      writes.push(value)
      event.sourceId = value
    },
    log: (level, message) => logs.push(`${level}: ${message}`),
  }
  const run = () => sync({ entity: 'Event', action: 'update', data: event }, config, fake.client, ports)
  const stWrites = () =>
    fake.calls.filter((call) => call.method !== 'GET' && call.url.hostname === 'api.servicetitan.io')
  const jobs = () => [...fake.jobs.values()]
  const link = (jobId: number) => `${fake.secrets.tenantId}:${jobId}`
  return { fake, config, event, account, writes, order, logs, ports, run, stWrites, jobs, link }
}

it('creates the legacy customer and job bodies, retains other fields, then makes zero writes on the echoed run', async () => {
  const f = fixture()
  const result = await f.run()
  expect(result.kind).toBe('created')
  const customer = f.fake.calls.find((call) => call.method === 'POST' && call.url.pathname.endsWith('/customers'))!
  expect(customer.body).toMatchObject({
    name: 'Acme Solar',
    type: 'Residential',
    address: { state: 'CA', zip: '00000', country: 'USA' },
    contacts: [{ type: 'Email', value: 'user@example.test', memo: 'email' }],
    customFields: [{ typeId: 1005, value: 'Account.example' }],
    locations: [{ customFields: [{ typeId: 1006, value: 'Account.example' }] }],
  })
  expect((customer.body as { address: object }).address).not.toHaveProperty('latitude')
  expect([...f.fake.jobs.values()][0]).toMatchObject({
    jobTypeId: 1001,
    businessUnitId: 3001,
    campaignId: 1002,
    priority: 'Normal',
    customFields: [
      { typeId: 1007, value: 'Example Setter' },
      { typeId: 1008, value: 'Scheduled' },
    ],
    appointments: [{ start: '2026-10-26T17:00:00.000Z', end: '2026-10-26T18:00:00.000Z', technicianIds: [2000] }],
  })
  expect(f.account.customFields!['CF.example']).toBe('keep')
  expect(f.account.customFields!['CF.servicetitanjob']).toBe(f.link(f.jobs()[0]!.id))
  expect(f.event.sourceId).toBe(f.link(f.jobs()[0]!.id))
  f.fake.calls.length = 0
  f.writes.length = 0
  expect(await f.run()).toEqual({ kind: 'unchanged' })
  expect(f.stWrites()).toEqual([])
  expect(f.writes).toEqual([])
})

it('reschedules duration-only edits but treats equivalent timezone offsets as the same instant', async () => {
  const f = fixture()
  await f.run()
  f.fake.calls.length = 0
  f.event.duration = 90
  expect(await f.run()).toEqual({ kind: 'updated', changes: ['appointment'] })
  expect(f.stWrites()[0]).toMatchObject({
    method: 'PATCH',
    body: { start: '2026-10-26T17:00:00.000Z', end: '2026-10-26T18:30:00.000Z' },
  })
  f.event.eventDate = '2026-10-26T17:00:00Z'
  f.fake.calls.length = 0
  expect(await f.run()).toEqual({ kind: 'unchanged' })
  expect(f.stWrites()).toEqual([])
})

it('reassigns only the first active assignment and cancels the old job using the configured reason', async () => {
  const f = fixture()
  await f.run()
  const oldJob = [...f.fake.jobs.values()][0]!
  f.fake.technicians.push({ id: 2001, name: 'Example Replacement', businessUnitId: 3002 })
  f.event.attendee!.clientUserId = '2001'
  f.fake.assignments.unshift({ appointmentId: oldJob.lastAppointmentId!, technicianId: 2001, active: false })
  f.fake.assignments.push({ appointmentId: oldJob.lastAppointmentId!, technicianId: 2001, active: true })
  f.fake.calls.length = 0
  const result = await f.run()
  expect(result).toMatchObject({ kind: 'reassigned', oldJobId: oldJob.id, oldJobCancelled: true })
  const replacement = [...f.fake.jobs.values()][1]!
  expect(replacement).toMatchObject({
    customerId: oldJob.customerId,
    locationId: oldJob.locationId,
    businessUnitId: 3002,
  })
  expect(f.stWrites().map((call) => [call.method, call.url.pathname.split('/').at(-1)])).toEqual([
    ['POST', 'jobs'],
    ['PUT', 'cancel'],
  ])
  expect(f.stWrites().at(-1)!.body).toEqual({ reasonId: 9001, memo: 'Closer reassigned via automation' })
  expect(f.stWrites()[0]!.body).not.toHaveProperty('id')
  expect(f.stWrites()[0]!.body).not.toHaveProperty('lastAppointmentId')
  expect(f.event.sourceId).toBe(f.link(replacement.id))
  expect(f.account.customFields!['CF.servicetitanjob']).toBe(f.link(replacement.id))
})

// Nothing retries a failed cancel, so it is logged with a fixed marker; the next run follows the new link.
it('links the replacement before cancelling and logs an abandoned cancel with both job IDs', async () => {
  const f = fixture()
  await f.run()
  const oldJob = f.jobs()[0]!
  f.fake.technicians.push({ id: 2001, name: 'Example Replacement', businessUnitId: 3002 })
  f.event.attendee!.clientUserId = '2001'
  f.fake.calls.length = 0
  f.order.length = 0
  f.fake.replies.set(`PUT /jpm/v2/tenant/1000/jobs/${oldJob.id}/cancel`, [{ status: 400 }])
  const result = await f.run()
  const replacement = f.jobs()[1]!
  expect(result).toEqual({ kind: 'reassigned', oldJobId: oldJob.id, jobId: replacement.id, oldJobCancelled: false })
  expect(f.logs).toContainEqual(
    expect.stringMatching(
      new RegExp(
        `^error: SERVICETITAN_ABANDONED_CANCEL tenant=1000 oldJob=${oldJob.id} newJob=${replacement.id}: .*HTTP 400`
      )
    )
  )
  const createdAt = f.fake.calls.findIndex((call) => call.method === 'POST')
  const cancelAt = f.fake.calls.findIndex((call) => call.method === 'PUT')
  expect(f.order).toHaveLength(1)
  const linkedAt = Number(f.order[0]!.split('@')[1])
  expect(createdAt).toBeLessThan(linkedAt)
  expect(linkedAt).toBeLessThanOrEqual(cancelAt)
  expect(f.account.customFields!['CF.servicetitanjob']).toBe(f.link(replacement.id))
  expect(await f.run()).toEqual({ kind: 'unchanged' })
  expect(f.fake.jobs.size).toBe(2)
})

it('backfills migrated event links once without rewriting the account or unchanged ServiceTitan job', async () => {
  const f = fixture()
  await f.run()
  delete f.event.sourceId
  f.writes.length = 0
  f.fake.calls.length = 0
  expect(await f.run()).toEqual({ kind: 'updated', changes: ['event sourceId'] })
  expect(f.writes).toHaveLength(1)
  expect(f.stWrites()).toEqual([])
})

it('updates campaign and outcome while ignoring setter name case and spaces', async () => {
  const f = fixture()
  await f.run()
  const job = [...f.fake.jobs.values()][0]!
  job.customFields![0]!.value = ' example SETTER '
  expect(await f.run()).toEqual({ kind: 'unchanged' })
  f.event.owner!.closerStatus = 'Can_Close'
  f.event.status = 'Completed'
  f.fake.calls.length = 0
  expect(await f.run()).toEqual({ kind: 'updated', changes: ['job'] })
  expect(f.stWrites()[0]!.body).toMatchObject({
    campaignId: 1003,
    customFields: [
      { typeId: 1007, value: 'Example Setter' },
      { typeId: 1008, value: 'Completed' },
    ],
  })
})

it('deduplicates by the customer custom field and uses the first location with legacy search normalization', async () => {
  const f = fixture()
  f.fake.customers.push(
    { id: 5000, customFields: [{ typeId: 1005, value: 'Account.otherexample' }] },
    { id: 5001, customFields: [{ typeId: 1005, value: 'Account.example' }] }
  )
  f.fake.locations.push({ id: 6000, customerId: 5001 }, { id: 6001, customerId: 5001 })
  await f.run()
  expect([...f.fake.jobs.values()][0]).toMatchObject({ customerId: 5001, locationId: 6000 })
  expect(f.stWrites().some((call) => call.url.pathname.endsWith('/customers'))).toBe(false)
  const search = f.fake.calls.find((call) => call.method === 'GET' && call.url.pathname.endsWith('/customers'))!
  expect(Object.fromEntries(search.url.searchParams)).toEqual({
    name: 'Acme Solar',
    street: '1 Example Street',
    city: 'Example City',
    state: 'CA',
    zip: '00000',
  })
})

it('does not deduplicate without a customer custom field and includes coordinates when available', async () => {
  const f = fixture()
  delete f.config.customFieldCustomerId
  f.account.location!.latlng = { latitude: 0, longitude: 0 }
  await f.run()
  expect(f.fake.calls.some((call) => call.method === 'GET' && call.url.pathname.endsWith('/customers'))).toBe(false)
  const customer = f.fake.calls.find((call) => call.method === 'POST' && call.url.pathname.endsWith('/customers'))!
  expect(customer.body).toMatchObject({ address: { latitude: 0, longitude: 0 } })
})

it.each(['removed', 'type', 'attendee', 'owner', 'account', 'source', 'technician'] as const)(
  'skips %s events before making any writes',
  async (guard) => {
    const f = fixture()
    if (guard === 'type') f.event.eventType = 'Other'
    if (guard === 'attendee') delete f.event.attendee
    if (guard === 'owner') delete f.event.owner
    if (guard === 'account') delete f.event.account
    if (guard === 'source') f.account.accountSource = 'Imported'
    if (guard === 'technician') f.fake.technicians.length = 0
    const payload: CalendarEventWebhook =
      guard === 'removed'
        ? { entity: 'Event', action: 'remove', data: { id: f.event.id } }
        : { entity: 'Event', action: 'update', data: f.event }
    expect((await sync(payload, f.config, f.fake.client, f.ports)).kind).toBe('skipped')
    expect(f.stWrites()).toEqual([])
    expect(f.writes).toEqual([])
  }
)

it('fails missing locations instead of creating an unaddressed customer', async () => {
  const f = fixture()
  delete f.account.location
  await expect(f.run()).rejects.toThrow('no location')
  expect(f.stWrites()).toEqual([])
})

it('fails customer create errors instead of skipping or creating a job without a customer', async () => {
  const f = fixture()
  f.fake.replies.set('POST /crm/v2/tenant/1000/customers', [{ status: 400 }])
  await expect(f.run()).rejects.toThrow('HTTP 400')
  expect(f.fake.jobs.size).toBe(0)
  expect(f.writes).toEqual([])
})

it('skips accounts without a resident before calling ServiceTitan writes', async () => {
  const f = fixture()
  delete f.account.resident
  expect(await f.run()).toEqual({ kind: 'skipped', reason: 'missing resident' })
  expect(f.stWrites()).toEqual([])
})

// A failed search used to look like "no match" and created a duplicate customer.
it('fails a customer search error instead of creating a duplicate customer', async () => {
  const f = fixture()
  f.fake.replies.set('GET /crm/v2/tenant/1000/customers', [{ status: 403 }])
  await expect(f.run()).rejects.toThrow('HTTP 403')
  expect(f.stWrites()).toEqual([])
})

// A failed technician lookup used to skip, acknowledging the event without syncing it.
it('fails a technician lookup error instead of skipping', async () => {
  const f = fixture()
  f.fake.replies.set('GET /settings/v2/tenant/1000/technicians', [{ status: 403 }])
  await expect(f.run()).rejects.toThrow('HTTP 403')
  expect(f.stWrites()).toEqual([])
})

// Legacy logs a failed assignment lookup and still updates; throwing would block every update on a linked job.
it('logs an assignment lookup error and still updates and reschedules the job without reassigning', async () => {
  const f = fixture()
  await f.run()
  const job = f.jobs()[0]!
  f.fake.technicians.push({ id: 2001, name: 'Example Replacement', businessUnitId: 3002 })
  f.event.attendee!.clientUserId = '2001'
  f.event.status = 'Completed'
  f.event.duration = 90
  f.fake.calls.length = 0
  f.fake.replies.set('GET /dispatch/v2/tenant/1000/appointment-assignments', [{ status: 403 }])
  expect(await f.run()).toEqual({ kind: 'updated', changes: ['job', 'appointment'] })
  expect(f.fake.jobs.size).toBe(1)
  expect(f.stWrites().map((call) => [call.method, call.url.pathname.split('/').at(-1)])).toEqual([
    ['PATCH', String(job.id)],
    ['PATCH', 'reschedule'],
  ])
  expect(f.logs).toContainEqual(expect.stringMatching(/^warn: ServiceTitan reassignment check skipped .*HTTP 403/))
})

it.each(['job', 'appointment'] as const)(
  'fails the run on a %s update error instead of reporting success',
  async (target) => {
    const f = fixture()
    await f.run()
    const job = f.jobs()[0]!
    if (target === 'job') {
      f.event.status = 'Completed'
      f.fake.replies.set(`PATCH /jpm/v2/tenant/1000/jobs/${job.id}`, [{ status: 400 }])
    } else {
      f.event.duration = 90
      f.fake.replies.set(`PATCH /jpm/v2/tenant/1000/appointments/${job.lastAppointmentId}/reschedule`, [
        { status: 400 },
      ])
    }
    await expect(f.run()).rejects.toThrow('HTTP 400')
  }
)

it('does not write a blank outcome when the event has no status', async () => {
  const f = fixture()
  delete f.event.status
  await f.run()
  expect(f.jobs()[0]!.customFields).toEqual([{ typeId: 1007, value: 'Example Setter' }])
  f.fake.calls.length = 0
  expect(await f.run()).toEqual({ kind: 'unchanged' })
})

it('follows a tenant-prefixed event sourceId when the account field is empty', async () => {
  const f = fixture()
  await f.run()
  const job = f.jobs()[0]!
  delete f.account.customFields!['CF.servicetitanjob']
  f.event.sourceId = `1000:${job.id}`
  f.fake.calls.length = 0
  const result = await f.run()
  expect(result).toMatchObject({ kind: 'updated', changes: expect.arrayContaining(['account custom field']) })
  expect(f.fake.jobs.size).toBe(1)
  expect(f.stWrites()).toEqual([])
  expect(f.account.customFields!['CF.servicetitanjob']).toBe(f.link(job.id))
})

// Legacy never wrote event.sourceId, so a bare number there came from something else and must not pick a job.
it.each(['bare numeric', 'non-ServiceTitan'])('ignores a %s event sourceId and creates a new job', async (kind) => {
  const f = fixture()
  f.fake.jobs.set(4999, { id: 4999, customerId: 1, locationId: 1, campaignId: 1 })
  f.event.sourceId = kind === 'bare numeric' ? '4999' : 'example-calendar:abc'
  expect(await f.run()).toMatchObject({ kind: 'created' })
  const created = f.jobs()[1]!
  expect(f.fake.calls.some((call) => call.url.pathname.endsWith('/jobs/4999'))).toBe(false)
  expect(f.event.sourceId).toBe(f.link(created.id))
})

it('reads a legacy bare numeric account link and rewrites it with the tenant prefix', async () => {
  const f = fixture()
  await f.run()
  const job = f.jobs()[0]!
  f.account.customFields!['CF.servicetitanjob'] = String(job.id)
  f.event.sourceId = String(job.id)
  f.fake.calls.length = 0
  expect(await f.run()).toEqual({ kind: 'updated', changes: ['account custom field', 'event sourceId'] })
  expect(f.stWrites()).toEqual([])
  expect(f.account.customFields!['CF.servicetitanjob']).toBe(f.link(job.id))
})

// A malformed link used to fall through to creating a new job on every sync.
it.each(['abc', '0', '1000:abc', '1000:', '9007199254740993'])(
  'fails an invalid account link %j without creating anything',
  async (value) => {
    const f = fixture()
    f.account.customFields!['CF.servicetitanjob'] = value
    const run = f.run()
    await expect(run).rejects.toThrow(`Invalid ServiceTitan job link "${value}"`)
    await expect(run).rejects.toBeInstanceOf(PermanentError)
    expect(f.fake.calls).toEqual([])
    expect(f.writes).toEqual([])
  }
)

it('skips a job linked to another ServiceTitan tenant', async () => {
  const f = fixture()
  f.account.customFields!['CF.servicetitanjob'] = '1001:4000'
  expect(await f.run()).toEqual({ kind: 'skipped', reason: 'job linked to another ServiceTitan tenant' })
  expect(f.fake.calls).toEqual([])
})

it('parses tenant-prefixed and legacy links and rejects the rest', () => {
  expect(parseJobLink(undefined, '1000')).toEqual({ kind: 'none' })
  expect(parseJobLink(' ', '1000')).toEqual({ kind: 'none' })
  expect(parseJobLink('1000:42', '1000')).toEqual({ kind: 'job', jobId: 42 })
  expect(parseJobLink(' 42 ', '1000')).toEqual({ kind: 'job', jobId: 42 })
  expect(parseJobLink(42, '1000')).toEqual({ kind: 'job', jobId: 42 })
  expect(parseJobLink('42', '1000', false)).toEqual({ kind: 'none' })
  expect(parseJobLink('1000:42', '1000', false)).toEqual({ kind: 'job', jobId: 42 })
  expect(parseJobLink('2000:42', '1000')).toEqual({ kind: 'otherTenant' })
  expect(parseJobLink('-1', '1000')).toEqual({ kind: 'invalid', value: '-1' })
  expect(parseJobLink('undefined', '1000')).toEqual({ kind: 'invalid', value: 'undefined' })
})

it('retries failed location reads with backoff before using the new customer', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.fake.replies.set('GET /crm/v2/tenant/1000/locations', [{ status: 503 }, { status: 503 }])
    const pending = f.run()
    await vi.runAllTimersAsync()
    expect((await pending).kind).toBe('created')
    expect(f.fake.calls.filter((call) => call.url.pathname.endsWith('/locations'))).toHaveLength(3)
  } finally {
    vi.useRealTimers()
  }
})

it('uses the exact campaign fallback order and fails when none is configured', () => {
  const { config } = fixture()
  expect(determineCampaignId('Needs_Help', config)).toBe(1002)
  delete config.campaignIdSetterGen
  expect(determineCampaignId('Needs_Help', config)).toBe(1003)
  delete config.campaignIdCloserGen
  expect(determineCampaignId(undefined, config)).toBe(1004)
  delete config.campaignIdUnknown
  expect(() => determineCampaignId(undefined, config)).toThrow('No campaignId')
})

const technicianSearch = 'GET /settings/v2/tenant/1000/technicians'

// An engine timeout is the one case the platform redelivers, and a redelivery after an unlinked create duplicates it.
it('stops a run with hung ServiceTitan reads inside the run budget', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    const started = Date.now()
    f.fake.replies.set(technicianSearch, [{ error: 'hang' }, { error: 'hang' }, { error: 'hang' }, { error: 'hang' }])
    const pending = f.run()
    const settled = expect(pending).rejects.toThrow('network error or timeout')
    await vi.runAllTimersAsync()
    await settled
    expect(Date.now() - started).toBeLessThanOrEqual(45_000)
    expect(f.fake.calls.filter((call) => call.url.pathname.endsWith('/technicians'))).toHaveLength(3)
    expect(f.stWrites()).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

it('skips and logs instead of starting a create with too little budget left', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    // Two hung reads with their backoff use about 29 of the 45 seconds, leaving less than the 20-second reserve.
    f.fake.replies.set(technicianSearch, [{ error: 'hang' }, { error: 'hang' }])
    const pending = f.run()
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({
      kind: 'skipped',
      reason: expect.stringContaining('run budget too low to start a ServiceTitan create'),
    })
    expect(f.stWrites()).toEqual([])
    expect(f.writes).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

it('does not start a replacement job create with too little budget left', async () => {
  const f = fixture({ budgetMs: 19_000 })
  f.fake.jobs.set(4000, { id: 4000, customerId: 1, locationId: 1, campaignId: 1002, lastAppointmentId: 4001 })
  f.fake.appointments.set(4001, { id: 4001, start: '2026-10-26T17:00:00.000Z', end: '2026-10-26T18:00:00.000Z' })
  f.fake.assignments.push({ appointmentId: 4001, technicianId: 2999, active: true })
  f.account.customFields!['CF.servicetitanjob'] = '1000:4000'
  expect(await f.run()).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('run budget too low') })
  expect(f.stWrites()).toEqual([])
})

it('logs the created job ID before saving the link', async () => {
  const f = fixture()
  f.ports.writeAccountCustomField = async () => {
    throw new Error('example account write failure')
  }
  await expect(f.run()).rejects.toThrow('example account write failure')
  expect(f.logs).toContain(`info: ServiceTitan job created: ${f.jobs()[0]!.id}`)
})
