import { RunBudget, ServiceTitanClient } from './servicetitan.ts'
import { fakeServiceTitan } from './fakeServiceTitan.ts'

afterEach(() => vi.useRealTimers())

// Installs share the Lambda, so one install's token must never be sent for another tenant.
it('keeps OAuth tokens isolated per client ID and tenant across installs', async () => {
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({ ids: ['2000'] })
  await new ServiceTitanClient(fake.secrets, fake.fakeFetch).searchTechnicians({})
  await new ServiceTitanClient({ ...fake.secrets, tenantId: '1001' }, fake.fakeFetch).searchTechnicians({})
  await new ServiceTitanClient({ ...fake.secrets, clientId: 'other-example-client' }, fake.fakeFetch).searchTechnicians(
    {}
  )
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(3)
})

// A rotated secret must not keep using a token minted with the old one.
it('keys cached tokens by a hash of the client secret, never the raw secret', async () => {
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({})
  await new ServiceTitanClient(
    { ...fake.secrets, clientSecret: 'rotated-example-secret' },
    fake.fakeFetch
  ).searchTechnicians({})
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(2)
  const keys = [...(ServiceTitanClient as unknown as { tokens: Map<string, unknown> }).tokens.keys()]
  const ours = keys.filter((key) => key.startsWith(`${fake.secrets.clientId}:`))
  expect(ours).toHaveLength(2)
  expect(ours.join()).not.toContain('example-secret')
})

const authCalls = (fake: ReturnType<typeof fakeServiceTitan>) =>
  fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))

it('drops the cached token on a 401 and re-authenticates once', async () => {
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({})
  fake.replies.set('GET /settings/v2/tenant/1000/technicians', [{ status: 401 }])
  expect(await fake.client.searchTechnicians({})).toMatchObject({ ok: true })
  expect(authCalls(fake)).toHaveLength(2)
  fake.replies.set('GET /settings/v2/tenant/1000/technicians', [{ status: 401 }, { status: 401 }])
  expect(await fake.client.searchTechnicians({})).toMatchObject({
    ok: false,
    retryable: false,
    message: expect.stringContaining('HTTP 401'),
  })
  expect(authCalls(fake)).toHaveLength(3)
  // The rejected token is not reused on the next call.
  await fake.client.searchTechnicians({})
  expect(authCalls(fake)).toHaveLength(4)
})

it('refreshes the token sixty seconds early so an expiring token is not sent', async () => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan()
  // A new client per run, as in the Lambda; the token cache outlives it.
  const run = () => new ServiceTitanClient(fake.secrets, fake.fakeFetch).searchTechnicians({})
  await run()
  vi.advanceTimersByTime(839_000)
  await run()
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(1)
  vi.advanceTimersByTime(1000)
  await run()
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(2)
})

it('sends tenant-scoped URLs, credentials, app key and timeouts without mixing name and ID lookup', async () => {
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({ ids: ['2000'], name: 'Ignored Example' })
  const auth = fake.calls[0]!
  expect(auth.url.href).toBe('https://auth.servicetitan.io/connect/token')
  expect(auth.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded')
  expect(new URLSearchParams(String(auth.body)).get('grant_type')).toBe('client_credentials')
  expect(new URLSearchParams(String(auth.body)).get('client_secret')).toBe(fake.secrets.clientSecret)
  const call = fake.calls[1]!
  expect(call.url.href).toBe('https://api.servicetitan.io/settings/v2/tenant/1000/technicians?ids=2000')
  expect(call.headers.get('Authorization')).toBe('Bearer example-token')
  expect(call.headers.get('ST-App-Key')).toBe('example-key')
  expect(call.signal).toBeInstanceOf(AbortSignal)
  await fake.client.searchTechnicians({ name: 'Example Closer' })
  expect(fake.calls.at(-1)!.url.searchParams.get('name')).toBe('Example Closer')
})

const apiCalls = (fake: ReturnType<typeof fakeServiceTitan>) =>
  fake.calls.filter((call) => call.url.hostname === 'api.servicetitan.io')

const jobInput = {
  customerId: 1,
  locationId: 1,
  jobTypeId: 1,
  businessUnitId: 1,
  priority: 'Normal' as const,
  campaignId: 1,
  customFields: [],
  appointments: [],
}

async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return pending
}

it('returns missing records and failed writes as non-retryable failures without retrying', async () => {
  const fake = fakeServiceTitan()
  expect(await fake.client.getJob(9999)).toMatchObject({ ok: false, retryable: false })
  expect(await fake.client.getAppointment(9999)).toMatchObject({ ok: false, retryable: false })
  expect(await fake.client.updateJob(9999, { campaignId: 1002, customFields: [] })).toMatchObject({
    ok: false,
    retryable: false,
  })
  expect(apiCalls(fake)).toHaveLength(3)
})

// request returns failures as values, so the old throw-based retry never retried anything.
it.each([
  ['HTTP 429', { status: 429 }],
  ['HTTP 503', { status: 503 }],
  ['a network error', { error: 'network' as const }],
  ['a timeout', { error: 'timeout' as const }],
])('retries reads and updates after %s', async (_name, reply) => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan()
  fake.replies.set('GET /settings/v2/tenant/1000/technicians', [reply, reply])
  expect(await settle(fake.client.searchTechnicians({ ids: ['2000'] }))).toMatchObject({ ok: true })
  const job = { campaignId: 1002, customFields: [] }
  fake.jobs.set(4000, { id: 4000, customerId: 4001, locationId: 4002, campaignId: 1001 })
  fake.replies.set('PATCH /jpm/v2/tenant/1000/jobs/4000', [reply])
  expect(await settle(fake.client.updateJob(4000, job))).toMatchObject({ ok: true })
  expect(apiCalls(fake).map((call) => call.method)).toEqual(['GET', 'GET', 'GET', 'PATCH', 'PATCH'])
})

it('gives up after three attempts and does not retry client errors', async () => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan()
  fake.replies.set('GET /settings/v2/tenant/1000/technicians', [{ status: 500 }, { status: 500 }, { status: 500 }])
  expect(await settle(fake.client.searchTechnicians({}))).toMatchObject({ ok: false, retryable: true })
  expect(apiCalls(fake)).toHaveLength(3)
  fake.calls.length = 0
  fake.replies.set('GET /settings/v2/tenant/1000/technicians', [{ status: 400 }])
  expect(await settle(fake.client.searchTechnicians({}))).toMatchObject({ ok: false, retryable: false })
  expect(apiCalls(fake)).toHaveLength(1)
})

// A create that timed out may have succeeded, so retrying it would duplicate the job or customer.
it.each([{ error: 'timeout' as const }, { status: 503 }])(
  'never retries job or customer creates (%j)',
  async (reply) => {
    vi.useFakeTimers()
    const fake = fakeServiceTitan()
    fake.replies.set('POST /jpm/v2/tenant/1000/jobs', [reply])
    fake.replies.set('POST /crm/v2/tenant/1000/customers', [reply])
    const address = { street: '', city: '', state: '', zip: '', country: 'USA' as const }
    expect(await settle(fake.client.createJob(jobInput))).toMatchObject({ ok: false })
    expect(
      await settle(
        fake.client.createCustomer({ name: 'Acme Solar', type: 'Residential', address, contacts: [], locations: [] })
      )
    ).toMatchObject({ ok: false })
    expect(apiCalls(fake).map((call) => call.method)).toEqual(['POST', 'POST'])
    expect(fake.jobs.size).toBe(0)
    expect(fake.customers).toHaveLength(0)
  }
)

// An unvalidated response let a missing id become the string "undefined" in the account link.
it('rejects responses without a valid ID instead of returning undefined', async () => {
  const fake = fakeServiceTitan()
  fake.replies.set('POST /jpm/v2/tenant/1000/jobs', [{ status: 200, body: { customerId: 1 } }])
  fake.replies.set('GET /jpm/v2/tenant/1000/jobs/4000', [{ status: 200, body: { id: 'abc' } }])
  expect(await fake.client.createJob(jobInput)).toMatchObject({ ok: false, retryable: false })
  // Only the ID is required from a create, so a successful create is always linked.
  fake.replies.set('POST /jpm/v2/tenant/1000/jobs', [{ status: 200, body: { id: 4321, customerId: null } }])
  expect(await fake.client.createJob(jobInput)).toEqual({ ok: true, value: { id: 4321 } })
  expect(await fake.client.getJob(4000)).toMatchObject({
    ok: false,
    message: expect.stringContaining('invalid response'),
  })
  // A live response must not accept the negative ids dry-run uses, or a bad create could be linked.
  fake.replies.set('POST /jpm/v2/tenant/1000/jobs', [{ status: 200, body: { id: -1 } }])
  expect(await fake.client.createJob(jobInput)).toMatchObject({ ok: false, retryable: false })
})

it('treats a successful empty update response as success', async () => {
  const fake = fakeServiceTitan()
  fake.replies.set('PUT /jpm/v2/tenant/1000/jobs/4000/cancel', [{ status: 204 }])
  expect(await fake.client.cancelJob(4000, { reasonId: 1, memo: 'example' })).toMatchObject({ ok: true })
})

it('times out a hung request after ten seconds', async () => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan()
  fake.replies.set('POST /jpm/v2/tenant/1000/jobs', [{ error: 'hang' }])
  const started = Date.now()
  expect(await settle(fake.client.createJob(jobInput))).toMatchObject({ ok: false, retryable: true })
  expect(Date.now() - started).toBe(10_000)
})

it('caps a request at the remaining budget and does not retry past it', async () => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan({ budgetMs: 18_000 })
  fake.replies.set('GET /settings/v2/tenant/1000/technicians', [{ error: 'hang' }, { error: 'hang' }])
  const started = Date.now()
  expect(await settle(fake.client.searchTechnicians({}))).toMatchObject({ ok: false, retryable: true })
  // 10 s attempt, then a retry would leave under the 15 s reserve, so it stops.
  expect(Date.now() - started).toBe(10_000)
  expect(apiCalls(fake)).toHaveLength(1)
})

it('sends nothing once the run budget is exhausted', async () => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan()
  const client = new ServiceTitanClient(fake.secrets, fake.fakeFetch, new RunBudget(5000))
  vi.advanceTimersByTime(5000)
  expect(await client.searchTechnicians({})).toMatchObject({
    ok: false,
    message: expect.stringContaining('budget exhausted'),
  })
  expect(fake.calls).toEqual([])
})
