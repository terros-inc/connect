import {
  determineCampaignId,
  sync,
  type Account,
  type CalendarEventWebhook,
  type EventData,
  type Ports,
} from './sync.ts'
import { fakeServiceTitan } from './fakeServiceTitan.ts'
import { parseConfig } from './config.ts'

function fixture() {
  const fake = fakeServiceTitan()
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
      postal1: '00000-0000',
    },
  }
  const writes: unknown[] = []
  const ports: Ports = {
    readAccount: async () => account,
    writeAccountCustomField: async (_id, fields) => {
      writes.push(fields)
      account.customFields = fields
    },
    writeEventSourceId: async (_id, value) => {
      writes.push(value)
      event.sourceId = value
    },
  }
  const run = () => sync({ entity: 'Event', action: 'update', data: event }, config, fake.client, ports)
  const stWrites = () =>
    fake.calls.filter((call) => call.method !== 'GET' && call.url.hostname === 'api.servicetitan.io')
  return { fake, config, event, account, writes, ports, run, stWrites }
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
  expect(f.account.customFields!['CF.servicetitanjob']).toBe(f.event.sourceId)
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
  expect(result).toMatchObject({ kind: 'reassigned', oldJobId: oldJob.id })
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
  expect(f.event.sourceId).toBe(String(replacement.id))
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

it('skips customer create failures instead of creating a job without a customer', async () => {
  const f = fixture()
  f.fake.replies.set('POST /crm/v2/tenant/1000/customers', [{ status: 400 }])
  expect(await f.run()).toEqual({ kind: 'skipped', reason: 'customer lookup or creation failed' })
  expect(f.fake.jobs.size).toBe(0)
  expect(f.writes).toEqual([])
})

it('retries thrown location reads with legacy backoff before using the new customer', async () => {
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
