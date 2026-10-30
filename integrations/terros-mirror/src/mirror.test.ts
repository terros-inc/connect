// Runs both scripts against an in-memory fake of the target company's Terros API behind a stubbed global fetch.
// The fake matches by sourceId the way account/upsert, account/match and calendar/event/upsert do, so the tests
// show what the target company ends up holding, not which calls were made.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { handler as copyAppointment } from './appointment.ts'
import { handler as copyAccount } from './account.ts'

const TARGET_KEY = 'target-key-example'

type Json = Record<string, any>

class FakeTargetCompany {
  accounts: Json[] = []
  events: Json[] = []
  /** Route that answers the next call with an HTTP 500, as the API does on an internal error. */
  failNext: string | undefined

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const route = new URL(url).pathname.slice(1)
    const headers = init.headers as Record<string, string>
    if (headers.authorization !== `ApiKey ${TARGET_KEY}`)
      return new Response('', { status: 401, statusText: 'Unauthorized' })
    if (route === this.failNext) {
      this.failNext = undefined
      return new Response('', { status: 500, statusText: 'Internal Server Error' })
    }
    const body = JSON.parse(String(init.body))
    return Response.json({ type: 'success', ...this.handle(route, body) })
  }

  private handle(route: string, body: Json): Json {
    switch (route) {
      case 'account/upsert':
        return { account: this.upsert(this.accounts, body.account, 'Account') }
      case 'account/match':
        return { account: this.accounts.find((a) => a.sourceId === body.sourceId) }
      case 'calendar/event/upsert':
        return { event: this.upsert(this.events, body.event, 'Event') }
      default:
        throw new Error(`The fake Terros API has no route ${route}`)
    }
  }

  private upsert(records: Json[], input: Json, prefix: string): Json {
    const existing = input.sourceId && records.find((r) => r.sourceId === input.sourceId)
    if (existing) return Object.assign(existing, input)
    const id = prefix === 'Account' ? 'accountId' : 'eventId'
    const created = { ...input, [id]: `${prefix}.example-target-${records.length + 1}` }
    records.push(created)
    return created
  }
}

// Shaped like the Account and Event webhooks Terros sends for a newly booked lead.
const accountAdded = {
  entity: 'Account',
  action: 'add',
  data: {
    id: 'Account.example-source',
    createdAt: '1761800000000',
    updatedAt: '1761800000000',
    accountStatus: 'Set',
    workflowState: { workflowId: 'WF.example', stageId: 'S.example', stageName: 'Appointment Set' },
    externalLeadId: 'lead-example',
    owner: {
      userId: 'U.example-setter',
      firstName: 'Sam',
      lastName: 'Setter',
      email: 'setter@example.test',
      clientUserId: 'setter-example',
    },
    resident: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test', phone: '5555550100' },
    address: {
      locationId: 'TLoc.example',
      latlng: { latitude: 33.6846, longitude: -117.8265 },
      line1: '123 Main St',
      line2: 'Irvine, CA 92618',
      countrySubd: 'CA',
      locality: 'Irvine',
      postal1: '92618',
    },
    customFieldMap: { 'CF.example': 'source-only value' },
  },
} as const

const appointmentAdded = {
  entity: 'Event',
  action: 'add',
  data: {
    id: 'Event.example-booked',
    title: 'Consultation with Jane Doe',
    eventDate: '1761832800000',
    duration: 60,
    eventType: 'Consultation',
    note: 'Gate code 1234',
    createdAt: '1761800000000',
    updatedAt: '1761800000000',
    account: { accountId: 'Account.example-source', residents: [{ firstName: 'Jane', lastName: 'Doe' }] },
    owner: { userId: 'U.example-setter', firstName: 'Sam', lastName: 'Setter' },
  },
} as const

function run(
  handler: (input: any) => Promise<unknown>,
  payload: object,
  secrets: Record<string, string> = { targetApiKey: TARGET_KEY }
): Promise<unknown> {
  return handler({
    runId: 'ConnectRun.example',
    context: {
      payload,
      config: { scriptConfig: {}, secrets, authorization: 'ConnectKey source-token', authType: 'ConnectKey' },
    },
  })
}

let target: FakeTargetCompany

beforeEach(() => {
  target = new FakeTargetCompany()
  vi.stubGlobal('fetch', target.fetch)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Prevents: the copy landing in the source company (wrong key), or carrying source-only IDs into the target.
test('a new source account and its appointment create one target account and one appointment', async () => {
  await run(copyAccount, accountAdded)
  await run(copyAppointment, appointmentAdded)

  expect(target.accounts).toEqual([
    {
      accountId: 'Account.example-target-1',
      sourceId: 'Account.example-source',
      accountSource: 'Terros Mirror',
      resident: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test', phone: '5555550100' },
      location: {
        line1: '123 Main St',
        line2: 'Irvine, CA 92618',
        locality: 'Irvine',
        countrySubd: 'CA',
        postal1: '92618',
        latlng: { latitude: 33.6846, longitude: -117.8265 },
      },
    },
  ])
  expect(target.events).toEqual([
    {
      eventId: 'Event.example-target-1',
      sourceId: 'Event.example-booked',
      accountId: 'Account.example-target-1',
      title: 'Consultation with Jane Doe',
      eventType: 'Consultation',
      eventDate: 1761832800000,
      duration: 60,
      notes: 'Gate code 1234',
    },
  ])
})

// Prevents: a redelivered event (retry, or an engine timeout while the script still ran) duplicating the copy.
test('a repeated event creates no second account or appointment', async () => {
  await run(copyAccount, accountAdded)
  await run(copyAccount, accountAdded)
  await run(copyAppointment, appointmentAdded)
  await run(copyAppointment, appointmentAdded)

  expect(target.accounts).toHaveLength(1)
  expect(target.events).toHaveLength(1)
})

test('account updates and removals copy nothing', async () => {
  await run(copyAccount, { ...accountAdded, action: 'update' })
  await run(copyAccount, { entity: 'Account', action: 'remove', data: 'Account.example-source' })

  expect(target.accounts).toEqual([])
})

// Prevents: an appointment that arrives first creating its own account and racing the account copy into a duplicate.
test('an appointment whose account is not copied yet fails without creating anything, and its retry copies it', async () => {
  await expect(run(copyAppointment, appointmentAdded)).rejects.toThrow('has not been copied to the target company yet')
  expect(target.accounts).toEqual([])
  expect(target.events).toEqual([])

  await run(copyAccount, accountAdded)
  await run(copyAppointment, appointmentAdded)
  expect(target.events).toHaveLength(1)
})

// Prevents: a failed write being logged as a successful run, which drops the event without a retry.
test.each(['account/upsert', 'account/match', 'calendar/event/upsert'])(
  'a failed %s call fails the run',
  async (route) => {
    if (route !== 'account/upsert') await run(copyAccount, accountAdded)
    target.failNext = route

    const script = route === 'account/upsert' ? copyAccount : copyAppointment
    await expect(run(script, route === 'account/upsert' ? accountAdded : appointmentAdded)).rejects.toThrow(
      'Internal Server Error'
    )
  }
)

test('a rejected target API key fails the run, and a missing one fails it permanently', async () => {
  await expect(run(copyAccount, accountAdded, { targetApiKey: 'revoked-key-example' })).rejects.toThrow('Unauthorized')
  await expect(run(copyAccount, accountAdded, {})).rejects.toMatchObject({ name: 'PermanentError' })
})
