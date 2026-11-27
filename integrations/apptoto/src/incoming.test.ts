import { afterEach, beforeEach, vi } from 'vitest'
import type { CalendarEventData, TerrosClient } from '@terros-inc/sdk'
import { applyWebhook, type ApptotoWebhook } from './incoming.ts'

const secrets = { username: 'api-user', apiKey: 'example-secret' }
const config = {
  calendarId: '45',
  responseStageMappings: {
    participant_confirmed: 'Confirmed',
    participant_not_coming: 'Cancelled',
    participant_needs_reschedule: 'Reschedule',
  },
}

// Shapes follow Apptoto's documented webhook payloads, with placeholder contact details.
const apptotoEvent = {
  id: 123,
  calendar_id: 45,
  calendar_name: 'Example calendar',
  external_id: 'Event.example',
  start_time: '2026-10-14T09:00:00-07:00',
  end_time: '2026-10-14T10:30:00-07:00',
  created_on_calendar: '2026-10-12T15:04:11-07:00',
  updated_on_calendar: '2026-10-12T15:04:11-07:00',
  all_day: false,
  title: 'Consultation',
  tags: null,
  location: '',
  content: null,
  participants: null,
  custom_data: null,
  is_deleted: false,
}

function participantWebhook(state: string): ApptotoWebhook {
  return {
    participant: {
      id: 789,
      event_id: 123,
      display_name: 'Pat Example',
      name: 'Pat Example',
      phone: '555-555-0100',
      normalized_phone: '+15555550100',
      email: 'user@example.test',
      state,
      check_in_state: '',
      link: 'https://www.apptoto.com/p/example',
      reschedule_link: 'https://www.apptoto.com/r/example',
      direct_reschedule_link: 'https://www.apptoto.com/r/example?direct=1',
      cancel_link: 'https://www.apptoto.com/c/example',
      contact_id: 456,
      contact_external_id: null,
      tags: null,
      event: {
        id: 123,
        calendar_id: 45,
        title: 'Consultation',
        start_time: '2026-10-14T09:00:00-07:00',
        end_time: '2026-10-14T10:30:00-07:00',
      },
    },
    apptoto_id: '3_example',
  } as ApptotoWebhook
}

// GET /v1/event as Apptoto returns it now, with participant 789's current response.
function currentEvent(state: string) {
  return {
    ...apptotoEvent,
    participants: [
      {
        id: 789,
        name: 'Pat Example',
        phone: '555-555-0100',
        normalized_phone: '+15555550100',
        email: 'user@example.test',
        state,
      },
    ],
  }
}

const rescheduled = { start_time: '2026-10-15T13:00:00-07:00', end_time: '2026-10-15T14:00:00-07:00' }

const terrosEvent: CalendarEventData = {
  eventId: 'Event.example',
  eventType: 'Consultation',
  title: 'Consultation',
  eventDate: Date.parse('2026-10-14T09:00:00-07:00'),
  duration: 90,
  accountId: 'Account.example',
  ownerId: 'U.example',
}

function notFound(eventId: string): Error {
  return Object.assign(new Error(`NotFound: no event ${eventId}`), {
    name: 'TerrosApiError',
    code: 'NotFound',
    response: { type: 'error', error: 'NotFound' },
  })
}

function fakeTerros(events: CalendarEventData[] = [terrosEvent]) {
  const stored = new Map(events.map((event) => [event.eventId, { ...event }]))
  const writes: { route: string; input: any }[] = []
  const client = {
    account: {
      upsert: vi.fn(async (input) => {
        writes.push({ route: 'account/upsert', input })
        return { type: 'success', account: { accountId: input.account.accountId } }
      }),
    },
    calendar: {
      event: {
        get: vi.fn(async ({ eventId }) => {
          const event = stored.get(eventId)
          if (!event) throw notFound(eventId)
          return { type: 'success', event }
        }),
        update: vi.fn(async (input) => {
          writes.push({ route: 'calendar/event/update', input })
          const existing = stored.get(input.event.eventId)
          if (!existing) throw notFound(input.event.eventId)
          const event = { ...existing, ...input.event }
          stored.set(event.eventId, event)
          return { type: 'success', event }
        }),
        upsert: vi.fn(async (input) => {
          writes.push({ route: 'calendar/event/upsert', input })
          throw new Error('unexpected upsert')
        }),
        remove: vi.fn(async (input) => {
          writes.push({ route: 'calendar/event/remove', input })
          if (!stored.delete(input.eventId)) throw notFound(input.eventId)
          return { type: 'success' }
        }),
        add: vi.fn(async (input) => {
          writes.push({ route: 'calendar/event/add', input })
          throw new Error('unexpected create')
        }),
      },
    },
  } as unknown as TerrosClient
  return { client, stored, writes }
}

function installApptoto(events: Record<string, unknown>[] = [apptotoEvent]) {
  const requests: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input))
      requests.push(url)
      expect(init.method ?? 'GET').toBe('GET')
      expect(url.pathname).toBe('/v1/event')
      const found = events.find((event) => String(event.id) === url.searchParams.get('id'))
      return found ? Response.json(found) : Response.json({ error: 'not found' }, { status: 404 })
    })
  )
  return requests
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// The participant payload nests its event without external_id, so a lookup by Apptoto's own ids would match nothing.
test('a confirmation moves the linked account to the mapped stage, found through the Apptoto event id', async () => {
  const requests = installApptoto([currentEvent('confirmed')])
  const { client, writes } = fakeTerros()

  await applyWebhook(participantWebhook('confirmed'), client, config, secrets)

  expect(requests.map((url) => url.searchParams.get('id'))).toEqual(['123'])
  expect(writes).toEqual([
    {
      route: 'account/upsert',
      input: {
        requestType: 'update',
        account: { accountId: 'Account.example', workflowTarget: 'Confirmed' },
      },
    },
  ])
})

// Apptoto retries a 5xx up to 5 times; a write stamped with the delivery time would keep moving the account forward.
test('a redelivered confirmation writes the same account values', async () => {
  installApptoto([currentEvent('confirmed')])
  const { client, writes } = fakeTerros()
  vi.useFakeTimers({ now: Date.parse('2026-10-13T12:00:00Z'), toFake: ['Date'] })

  await applyWebhook(participantWebhook('confirmed'), client, config, secrets)
  vi.setSystemTime(Date.parse('2026-10-13T12:01:00Z'))
  await applyWebhook({ ...participantWebhook('confirmed'), apptoto_id: '4_example' }, client, config, secrets)

  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
})

// Apptoto reports a reschedule request as a not_coming_* state; mistaking it for a plain cancellation picks the wrong stage.
test.each([
  ['not_coming', 'Cancelled'],
  ['not_coming_no_reschedule', 'Cancelled'],
  ['not_coming_needs_reschedule', 'Reschedule'],
])('participant state %s moves the account to %s', async (state, stage) => {
  installApptoto([currentEvent(state)])
  const { client, writes } = fakeTerros()

  await applyWebhook(participantWebhook(state), client, config, secrets)

  expect(writes.map(({ input }) => input.account.workflowTarget)).toEqual([stage])
})

// Apptoto retries failed deliveries, so an older response can arrive after a newer one was applied.
test('a stale response redelivered after a newer one leaves the account at the newer stage', async () => {
  installApptoto([currentEvent('not_coming')])
  const { client, writes } = fakeTerros()

  await applyWebhook({ ...participantWebhook('not_coming'), apptoto_id: '4_first' }, client, config, secrets)
  await applyWebhook({ ...participantWebhook('confirmed'), apptoto_id: '3_retry' }, client, config, secrets)

  expect(writes.map(({ input }) => input.account.workflowTarget)).toEqual(['Cancelled', 'Cancelled'])
})

test('a response from a participant Apptoto no longer has on the event is skipped', async () => {
  installApptoto([{ ...currentEvent('confirmed'), participants: [] }])
  const { client, writes } = fakeTerros()

  await applyWebhook(participantWebhook('confirmed'), client, config, secrets)

  expect(writes).toEqual([])
})

test('a blank stage mapping leaves the account stage unchanged', async () => {
  installApptoto([currentEvent('confirmed')])
  const { client, writes } = fakeTerros()

  await applyWebhook(
    participantWebhook('confirmed'),
    client,
    { ...config, responseStageMappings: { ...config.responseStageMappings, participant_confirmed: ' ' } },
    secrets
  )
  await applyWebhook(participantWebhook('not_coming'), client, { calendarId: '45' }, secrets)

  expect(writes).toEqual([])
})

// Apptoto-only bookings and events synced from another calendar must never become Terros appointments.
test.each([
  ['an external id from another calendar system', 'gcal-event-123'],
  ['no external id', null],
  ['a Terros event id that no longer exists', 'Event.removed'],
])('an Apptoto event with %s is skipped without writing to Terros', async (_case, externalId) => {
  installApptoto([{ ...currentEvent('confirmed'), external_id: externalId }])
  const { client, writes } = fakeTerros()

  await applyWebhook(participantWebhook('confirmed'), client, config, secrets)
  await applyWebhook({ event: { ...apptotoEvent, ...rescheduled, external_id: externalId } }, client, config, secrets)
  await applyWebhook({ event: { ...apptotoEvent, external_id: externalId, is_deleted: true } }, client, config, secrets)

  expect(writes).toEqual([])
})

test('an event on another Apptoto calendar is skipped', async () => {
  installApptoto([{ ...currentEvent('confirmed'), calendar_id: 46 }])
  const { client, writes } = fakeTerros()

  await applyWebhook(participantWebhook('confirmed'), client, config, secrets)
  await applyWebhook({ event: { ...apptotoEvent, calendar_id: 46, is_deleted: true } }, client, config, secrets)

  expect(writes).toEqual([])
  expect(client.calendar.event.get).not.toHaveBeenCalled()
})

test('a rescheduled Apptoto event moves the linked Terros event to the new start and duration', async () => {
  installApptoto([{ ...apptotoEvent, ...rescheduled }])
  const { client, stored } = fakeTerros()

  await applyWebhook({ event: { ...apptotoEvent, ...rescheduled } }, client, config, secrets)

  expect(stored.get('Event.example')).toMatchObject({
    eventDate: Date.parse('2026-10-15T20:00:00Z'),
    duration: 60,
  })
})

// The Terros event can be removed after it was read; a reschedule written as an upsert would recreate it.
test('a reschedule for a Terros event removed since it was read creates nothing', async () => {
  installApptoto([{ ...apptotoEvent, ...rescheduled }])
  const { client, writes } = fakeTerros([])
  vi.mocked(client.calendar.event.get).mockResolvedValueOnce({ type: 'success', event: terrosEvent } as never)

  await applyWebhook({ event: { ...apptotoEvent, ...rescheduled } }, client, config, secrets)

  expect(writes.map(({ route }) => route)).toEqual(['calendar/event/update'])
})

// Apptoto Appointment Sync's own upsert fires event_updated; writing it back would loop between the two scripts.
test('an event update with the time Terros already has writes nothing', async () => {
  const renamed = { ...apptotoEvent, title: 'Renamed in Apptoto', updated_on_calendar: '2026-10-13T08:00:00-07:00' }
  installApptoto([renamed])
  const { client, writes } = fakeTerros()

  await applyWebhook({ event: renamed }, client, config, secrets)

  expect(writes).toEqual([])
})

// Apptoto Appointment Sync sends a zero-duration appointment with equal start and end; rejecting the echo fails the
// execution, and Apptoto retries it.
test('the echo of a zero-duration appointment writes nothing', async () => {
  const instant = { ...apptotoEvent, end_time: apptotoEvent.start_time }
  installApptoto([instant])
  const { client, writes } = fakeTerros([{ ...terrosEvent, duration: 0 }])

  await applyWebhook({ event: instant }, client, config, secrets)

  expect(writes).toEqual([])
})

// A retried older delivery must not undo a newer reschedule, which Apptoto Appointment Sync would then push back.
test('an older event webhook redelivered after a newer reschedule leaves the newer time', async () => {
  installApptoto([{ ...apptotoEvent, ...rescheduled }])
  const { client, stored, writes } = fakeTerros()

  await applyWebhook({ event: { ...apptotoEvent, ...rescheduled }, apptoto_id: '4_first' }, client, config, secrets)
  await applyWebhook({ event: apptotoEvent, apptoto_id: '3_retry' }, client, config, secrets)

  expect(writes).toHaveLength(1)
  expect(stored.get('Event.example')).toMatchObject({ eventDate: Date.parse('2026-10-15T20:00:00Z'), duration: 60 })
})

test('a delete webhook for an event Apptoto has since restored does not remove the Terros event', async () => {
  installApptoto()
  const { client, writes } = fakeTerros()

  await applyWebhook({ event: { ...apptotoEvent, is_deleted: true } }, client, config, secrets)

  expect(writes).toEqual([])
})

// Apptoto's docs don't say whether GET /v1/event returns a deleted event or a 404, so both must remove it.
test.each([
  ['returns it as deleted', [{ ...apptotoEvent, is_deleted: true }]],
  ['no longer returns it', []],
])(
  'a deleted Apptoto event removes the linked Terros event when Apptoto %s, and a redelivery changes nothing',
  async (_case, current) => {
    installApptoto(current)
    const { client, stored, writes } = fakeTerros()
    const deleted = { event: { ...apptotoEvent, is_deleted: true }, apptoto_id: '3_first' }

    await applyWebhook(deleted, client, config, secrets)
    await applyWebhook({ ...deleted, apptoto_id: '3_retry' }, client, config, secrets)

    expect(stored.size).toBe(0)
    expect(writes.map(({ route }) => route)).toEqual(['calendar/event/remove'])
  }
)

test.each([
  ['a confirmation', participantWebhook('confirmed'), currentEvent('confirmed')],
  ['a reschedule', { event: { ...apptotoEvent, ...rescheduled } }, { ...apptotoEvent, ...rescheduled }],
  ['a delete', { event: { ...apptotoEvent, is_deleted: true } }, { ...apptotoEvent, is_deleted: true }],
])('dry run writes nothing for %s, and the kill switch skips before any lookup', async (_case, payload, current) => {
  const requests = installApptoto([current])
  const { client, writes } = fakeTerros()

  await applyWebhook(payload, client, { ...config, dryRun: 'true' }, secrets)
  await applyWebhook(payload, client, { ...config, disabled: true }, secrets)

  expect(writes).toEqual([])
  expect(requests).toHaveLength(1)
  expect(client.calendar.event.get).toHaveBeenCalledTimes(1)
})
