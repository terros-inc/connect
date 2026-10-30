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
  /** The company's duplicate preference is Deny: an upsert matching an account only by address saves nothing. */
  denyDuplicates = false

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const route = new URL(url).pathname.slice(1)
    const headers = init.headers as Record<string, string>
    if (headers.authorization !== `ApiKey ${TARGET_KEY}`)
      return new Response('', { status: 401, statusText: 'Unauthorized' })
    if (route === this.failNext) {
      this.failNext = undefined
      return new Response('', { status: 500, statusText: 'Internal Server Error' })
    }
    const result = this.handle(route, JSON.parse(String(init.body)))
    if (!result) return new Response('', { status: 400, statusText: 'Bad Request' })
    return Response.json({ type: 'success', ...result })
  }

  /** Returns undefined for a request the API rejects as invalid. */
  private handle(route: string, body: Json): Json | undefined {
    switch (route) {
      case 'account/upsert': {
        const input = body.account
        const sameAddress = this.accounts.some(
          (a) => a.sourceId !== input.sourceId && a.location?.line1 === input.location?.line1
        )
        if (this.denyDuplicates && sameAddress) return {}
        return { account: this.upsert(this.accounts, input, 'Account') }
      }
      case 'account/match':
        return { account: this.accounts.find((a) => a.sourceId === body.sourceId) }
      case 'calendar/event/upsert': {
        const eventDate = toMillis(body.event.eventDate)
        if (eventDate === undefined) return undefined
        return { event: this.upsert(this.events, { ...body.event, eventDate }, 'Event') }
      }
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

/** Like the API, accepts UTC milliseconds or an ISO 8601 string, and rejects anything else (NaN is sent as null). */
function toMillis(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const millis = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
  return Number.isNaN(millis) ? undefined : millis
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
      firstName: 'Demo',
      lastName: 'Setter',
      email: 'setter@example.test',
      clientUserId: 'setter-example',
    },
    resident: { firstName: 'Example', lastName: 'Homeowner', email: 'homeowner@example.test', phone: '5555550100' },
    address: {
      locationId: 'TLoc.example',
      latlng: { latitude: 0, longitude: 0 },
      line1: '123 Example St',
      line2: 'Exampletown, ZZ 00000',
      countrySubd: 'ZZ',
      locality: 'Exampletown',
      postal1: '00000',
    },
    customFieldMap: { 'CF.example': 'source-only value' },
  },
} as const

const appointmentAdded = {
  entity: 'Event',
  action: 'add',
  data: {
    id: 'Event.example-booked',
    title: 'Consultation with Example Homeowner',
    eventDate: '2026-10-30T07:00:00.000-07:00',
    duration: 60,
    eventType: 'Consultation',
    note: 'Example note',
    createdAt: '1761800000000',
    updatedAt: '1761800000000',
    account: { accountId: 'Account.example-source', residents: [{ firstName: 'Example', lastName: 'Homeowner' }] },
    owner: { userId: 'U.example-setter', firstName: 'Demo', lastName: 'Setter' },
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

// Prevents: the copy landing in the source company (wrong key), carrying source-only IDs into the target, or sending
// the webhook's ISO eventDate in a form the upsert rejects, which fails every appointment copy.
test('a new source account and its appointment create one target account and one appointment', async () => {
  await run(copyAccount, accountAdded)
  await run(copyAppointment, appointmentAdded)

  expect(target.accounts).toEqual([
    {
      accountId: 'Account.example-target-1',
      sourceId: 'Account.example-source',
      accountSource: 'Terros Mirror',
      resident: { firstName: 'Example', lastName: 'Homeowner', email: 'homeowner@example.test', phone: '5555550100' },
      location: {
        line1: '123 Example St',
        line2: 'Exampletown, ZZ 00000',
        locality: 'Exampletown',
        countrySubd: 'ZZ',
        postal1: '00000',
        latlng: { latitude: 0, longitude: 0 },
      },
    },
  ])
  expect(target.events).toEqual([
    {
      eventId: 'Event.example-target-1',
      sourceId: 'Event.example-booked',
      accountId: 'Account.example-target-1',
      title: 'Consultation with Example Homeowner',
      eventType: 'Consultation',
      eventDate: Date.parse('2026-10-30T14:00:00.000Z'),
      duration: 60,
      notes: 'Example note',
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
test('a failed account/upsert call fails the run', async () => {
  target.failNext = 'account/upsert'
  await expect(run(copyAccount, accountAdded)).rejects.toThrow('Internal Server Error')
})

// Prevents: a copy the target company refused to save being logged as a successful run.
test('an account/upsert that saves nothing fails the run permanently', async () => {
  target.denyDuplicates = true
  await run(copyAccount, accountAdded)
  const neighbour = { ...accountAdded, data: { ...accountAdded.data, id: 'Account.example-source-2' } }
  await expect(run(copyAccount, neighbour)).rejects.toMatchObject({ name: 'PermanentError' })
  expect(target.accounts).toHaveLength(1)
})

test.each(['account/match', 'calendar/event/upsert'])('a failed %s call fails the run', async (route) => {
  await run(copyAccount, accountAdded)
  target.failNext = route
  await expect(run(copyAppointment, appointmentAdded)).rejects.toThrow('Internal Server Error')
})

test('a rejected target API key fails the run, and a missing one fails it permanently', async () => {
  await expect(run(copyAccount, accountAdded, { targetApiKey: 'revoked-key-example' })).rejects.toThrow('Unauthorized')
  await expect(run(copyAccount, accountAdded, {})).rejects.toMatchObject({ name: 'PermanentError' })
})
