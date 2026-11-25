import { afterEach, beforeEach, vi } from 'vitest'
import type { TerrosClient } from '@terros-inc/sdk'
import { syncAppointment, type CalendarEventWebhook } from './outgoing.ts'

const config = { calendarId: '42' }
const secrets = { username: 'api-user', apiKey: 'example-secret' }
const event: CalendarEventWebhook = {
  entity: 'Event',
  action: 'add',
  data: {
    id: 'Event.example',
    title: 'Consultation',
    eventDate: '2026-09-01T17:00:00-05:00',
    duration: 90,
    account: { accountId: 'Account.example' },
  },
}

function fakeClient(): TerrosClient {
  return {
    account: {
      get: vi.fn().mockResolvedValue({
        account: {
          accountId: 'Account.example',
          resident: {
            firstName: 'Pat',
            lastName: 'Example',
            phone: '+15555550100',
            email: 'user@example.test',
          },
        },
      }),
    },
  } as unknown as TerrosClient
}

type StoredEvent = Record<string, unknown> & { external_id: string; calendar_id: string }
type FakeApptoto = {
  events: Map<string, StoredEvent>
  requests: { method: string; url: URL; body?: any }[]
}

function installApptoto(initial?: StoredEvent, writeResponse?: () => Response): FakeApptoto {
  const events = new Map<string, StoredEvent>()
  if (initial) events.set(initial.external_id, initial)
  const requests: { method: string; url: URL; body?: any }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ method, url, body })
      expect(init.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('api-user:example-secret').toString('base64')}`,
      })

      const externalId = url.searchParams.get('external_id')!
      if (method === 'GET') {
        const found = events.get(externalId)
        return found ? Response.json({ id: 7, ...found }) : Response.json({ error: 'not found' }, { status: 404 })
      }
      if (method === 'PUT') {
        for (const update of body.events) events.set(update.external_id, { ...update })
        return writeResponse?.() ?? Response.json({ events: body.events })
      }
      if (method === 'DELETE') {
        events.delete(externalId)
        return writeResponse?.() ?? Response.json({ events: [] })
      }
      return Response.json({ error: 'unexpected request' }, { status: 500 })
    })
  )
  return { events, requests }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('creates one event with the full linked-account participant', async () => {
  const world = installApptoto()

  await syncAppointment(event, fakeClient(), config, secrets)

  expect([...world.events.values()]).toEqual([
    {
      external_id: 'Event.example',
      calendar_id: '42',
      title: 'Consultation',
      start_time: '2026-09-01T22:00:00.000Z',
      end_time: '2026-09-01T23:30:00.000Z',
      participants: [{ name: 'Pat Example', phone: '+15555550100', email: 'user@example.test' }],
    },
  ])
  expect(world.requests.at(-1)?.body.prevent_calendar_creation).toBe(true)
})

test('a second save updates by external id without creating a duplicate', async () => {
  const world = installApptoto()
  const client = fakeClient()

  await syncAppointment(event, client, config, secrets)
  await syncAppointment(
    { ...event, action: 'update', data: { ...event.data, title: 'Updated consultation' } },
    client,
    config,
    secrets
  )

  expect(world.events).toHaveLength(1)
  expect(world.events.get('Event.example')?.title).toBe('Updated consultation')
  expect(world.requests.filter(({ method }) => method === 'PUT')).toHaveLength(2)
})

test('removing an appointment deletes it by external id so reminders stop', async () => {
  const world = installApptoto({ external_id: 'Event.example', calendar_id: '42' })

  await syncAppointment(
    { entity: 'Event', action: 'remove', data: { id: 'Event.example' } },
    fakeClient(),
    config,
    secrets
  )

  expect(world.events).toHaveLength(0)
  expect(world.requests.map(({ method }) => method)).toEqual(['GET', 'DELETE'])
})

test('accepts successful writes without a response body instead of retrying them', async () => {
  const world = installApptoto(undefined, () => new Response(null, { status: 204 }))

  await syncAppointment(event, fakeClient(), config, secrets)

  expect(world.events).toHaveLength(1)
  expect(world.requests.filter(({ method }) => method === 'PUT')).toHaveLength(1)
})

test('skips an update when the existing event belongs to another calendar', async () => {
  const world = installApptoto({ external_id: 'Event.example', calendar_id: '99' })

  await syncAppointment(event, fakeClient(), config, secrets)

  expect(world.requests).toHaveLength(1)
  expect(world.requests[0]?.method).toBe('GET')
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Apptoto cannot move events'))
})

test('skips a delete when the existing event belongs to another calendar', async () => {
  const world = installApptoto({ external_id: 'Event.example', calendar_id: '99' })

  await syncAppointment(
    { entity: 'Event', action: 'remove', data: { id: 'Event.example' } },
    fakeClient(),
    config,
    secrets
  )

  expect(world.events).toHaveLength(1)
  expect(world.requests.map(({ method }) => method)).toEqual(['GET'])
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not configured calendar 42'))
})

test('stops on a 429 instead of consuming more of the minute or daily quota', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(Response.json({ error: 'rate limited' }, { status: 429, headers: { 'retry-after': '60' } }))
  vi.stubGlobal('fetch', request)

  await expect(syncAppointment(event, fakeClient(), config, secrets)).rejects.toThrow(
    'Apptoto rate limit exceeded; retry after 60'
  )
  expect(request).toHaveBeenCalledTimes(1)
})

test('honors the disabled and dry-run switches without writing', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  await syncAppointment(event, fakeClient(), { ...config, disabled: true }, secrets)
  expect(request).not.toHaveBeenCalled()

  const world = installApptoto()
  await syncAppointment(event, fakeClient(), { ...config, dryRun: true }, secrets)
  expect(world.requests.map(({ method }) => method)).toEqual(['GET'])
  expect(world.events).toHaveLength(0)
  expect(console.log).toHaveBeenLastCalledWith(
    'DRY RUN: would upsert Apptoto event for Terros event Event.example on calendar 42'
  )
  const logs = vi.mocked(console.log).mock.calls.flat().join(' ')
  expect(logs).not.toContain('Pat Example')
  expect(logs).not.toContain('+15555550100')
  expect(logs).not.toContain('user@example.test')
})
