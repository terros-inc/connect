import { afterEach, beforeEach, vi } from 'vitest'
import { handler as accountHandler } from './outgoing.ts'
import { CALENDAR_ID, CONNECT_USER, FakeApis, LOCATION_ID, PIPELINE_ID, makeInput } from './fakeApis.ts'
import { handler as appointmentWebhook } from './calendarIncoming.ts'
import { handler as appointmentSync, STAGE_WAIT_TIMEOUT_MS } from './calendar.ts'

const config = {
  locationId: LOCATION_ID,
  calendarId: CALENDAR_ID,
  pipelineId: PIPELINE_ID,
}

let world: FakeApis

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  world = new FakeApis()
  world.install()
})

afterEach(() => {
  vi.useRealTimers()
  expect(world.blocked).toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function runSync(payload: unknown) {
  world.asScript('gohighlevel-appointment-sync')
  return appointmentSync(makeInput(payload, config))
}

function runWebhook(calendar: Record<string, unknown>, locationId = LOCATION_ID) {
  world.asScript('gohighlevel-appointment-webhook')
  return appointmentWebhook(makeInput({ location: { id: locationId }, calendar }, config))
}

function linkedSetup() {
  world.addAccount({ accountId: 'Account.1', externalLeadId: 'contact-1' })
  world.addContact('contact-1')
  world.addAppt('appt-1', 'contact-1')
  return world.addEvent({
    eventId: 'Event.1',
    accountId: 'Account.1',
    attendeeEmail: 'closer@hq.test',
    sourceId: 'appt-1',
  })
}

const rescheduled = {
  id: CALENDAR_ID,
  appointmentId: 'appt-1',
  status: 'confirmed',
  startTime: '2026-10-06T10:00:00',
  endTime: '2026-10-06T11:30:00',
  selectedTimezone: 'America/Chicago',
}

describe('Appointment Webhook', () => {
  test('does not create a Terros event for an unknown sourceId', async () => {
    await runWebhook({ ...rescheduled, appointmentId: 'appt-unknown' })

    expect(world.terros.events.size).toBe(0)
    expect(world.terrosWrites()).toEqual([])
  })

  test('does not create a Terros event when an unknown appointment is cancelled', async () => {
    await runWebhook({
      ...rescheduled,
      appointmentId: 'appt-unknown',
      status: 'cancelled',
    })

    expect(world.terros.events.size).toBe(0)
    expect(world.terrosWrites()).toEqual([])
  })

  test('updates the time of a linked event', async () => {
    linkedSetup()

    await runWebhook(rescheduled)

    const event = world.terros.events.get('Event.1')!
    expect(new Date(event.eventDate).toISOString()).toBe('2026-10-06T15:00:00.000Z')
    expect(event.duration).toBe(90)
    expect(event.accountId).toBe('Account.1')
    expect(world.terros.events.size).toBe(1)
  })

  test('finds a linked event when it is rescheduled far from its old time', async () => {
    linkedSetup()

    await runWebhook({
      ...rescheduled,
      startTime: '2026-11-20T10:00:00',
      endTime: '2026-11-20T11:00:00',
    })

    expect(new Date(world.terros.events.get('Event.1')!.eventDate).toISOString()).toBe('2026-11-20T16:00:00.000Z')
  })

  test('removes the linked event on cancel without an upsert', async () => {
    linkedSetup()

    await runWebhook({ ...rescheduled, status: 'cancelled' })

    // The backend hard-deletes; it has no archive.
    expect(world.terros.events.has('Event.1')).toBe(false)
    expect(world.terrosWrites()).toEqual(['TERROS calendar/event/remove {"eventId":"Event.1"}'])
  })

  test('finds a linked event owned by another user', async () => {
    linkedSetup()
    expect(world.terros.events.get('Event.1')!.ownerId).not.toBe(CONNECT_USER)

    await runWebhook(rescheduled)

    expect(new Date(world.terros.events.get('Event.1')!.eventDate).toISOString()).toBe('2026-10-06T15:00:00.000Z')
  })

  test('finds a linked event when it is rescheduled more than 90 days away', async () => {
    linkedSetup()

    await runWebhook({
      ...rescheduled,
      startTime: '2027-06-20T10:00:00',
      endTime: '2027-06-20T11:00:00',
    })

    expect(new Date(world.terros.events.get('Event.1')!.eventDate).toISOString()).toBe('2027-06-20T15:00:00.000Z')
  })

  test('the manifest grants the permissions its reads and removes need', async () => {
    linkedSetup()
    world.asScript('gohighlevel-appointment-webhook')

    expect(world.permissions).toEqual(new Set(['company:read', 'event:read', 'event:save', 'event:manage']))
    world.permissions!.delete('event:read')
    await expect(
      appointmentWebhook(makeInput({ location: { id: LOCATION_ID }, calendar: rescheduled }, config))
    ).rejects.toThrow('event:read required')
  })

  test('a GHL cancel does not flip the GHL appointment back to confirmed', async () => {
    linkedSetup()
    world.ghl.appts.get('appt-1')!.appointmentStatus = 'cancelled'

    await runWebhook({ ...rescheduled, status: 'cancelled' })
    await runSync({
      entity: 'Event',
      action: 'remove',
      data: { id: 'Event.1' },
    })

    expect(world.ghl.appts.get('appt-1')!.appointmentStatus).toBe('cancelled')
    expect(world.ghlWrites()).toEqual([])
  })

  test('ignores another location and another calendar', async () => {
    linkedSetup()

    await runWebhook(rescheduled, 'other-location')
    await runWebhook({ ...rescheduled, id: 'other-calendar' })

    expect(world.terrosWrites()).toEqual([])
  })
})

describe('Appointment Sync: Terros remove', () => {
  test('cancels the GHL appointment of a removed event', async () => {
    linkedSetup()
    world.terros.events.delete('Event.1')

    await runSync({
      entity: 'Event',
      action: 'remove',
      data: { id: 'Event.1', sourceId: 'appt-1' },
    })

    expect(world.ghl.appts.get('appt-1')!.appointmentStatus).toBe('cancelled')
    expect(world.ghl.appts.size).toBe(1)
    expect(world.ghlWrites()).toEqual([
      `GHL PUT /calendars/events/appointments/appt-1 {"appointmentStatus":"cancelled"}`,
    ])
  })

  test('cancels through the still-readable event when the payload has no sourceId', async () => {
    linkedSetup()

    await runSync(world.removeWebhook('Event.1'))

    expect(world.ghl.appts.get('appt-1')!.appointmentStatus).toBe('cancelled')
  })

  test('a hard-deleted event with an id-only payload cannot be resolved and is skipped, not failed', async () => {
    linkedSetup()
    world.terros.events.delete('Event.1')

    await runSync(world.removeWebhook('Event.1'))

    expect(world.ghlWrites()).toEqual([])
    expect(world.ghl.appts.get('appt-1')!.appointmentStatus).toBe('confirmed')
  })

  test('does nothing when the appointment is already cancelled', async () => {
    linkedSetup()
    world.ghl.appts.get('appt-1')!.appointmentStatus = 'cancelled'

    await runSync({
      entity: 'Event',
      action: 'remove',
      data: { id: 'Event.1', sourceId: 'appt-1' },
    })

    expect(world.ghlWrites()).toEqual([])
  })

  test('does nothing when the event has no sourceId', async () => {
    world.addEvent({ eventId: 'Event.2' })

    await runSync({
      entity: 'Event',
      action: 'remove',
      data: { id: 'Event.2' },
    })

    expect(world.ghlWrites()).toEqual([])
  })

  test('does nothing when the sourceId is not a GHL appointment', async () => {
    world.addEvent({ eventId: 'Event.2', sourceId: 'somewhere-else' })

    await runSync({
      entity: 'Event',
      action: 'remove',
      data: { id: 'Event.2' },
    })

    expect(world.ghlWrites()).toEqual([])
  })
})

describe('Appointment Sync: waiting states are quiet skips', () => {
  test('a Consultation without an account', async () => {
    world.addEvent({ eventId: 'Event.1', attendeeEmail: 'closer@hq.test' })
    await runSync(world.eventWebhook('Event.1', 'add'))
    expect(world.log).toEqual([])
  })

  test('a Consultation without an attendee', async () => {
    world.addAccount({ accountId: 'Account.1' })
    world.addEvent({ eventId: 'Event.1', accountId: 'Account.1' })
    await runSync(world.eventWebhook('Event.1', 'add'))
    expect(world.log).toEqual([])
  })

  test('a Consultation whose account never gets a workflow stage', async () => {
    vi.useFakeTimers()
    world.addAccount({ accountId: 'Account.1', workflowStageName: undefined })
    world.addEvent({
      eventId: 'Event.1',
      accountId: 'Account.1',
      attendeeEmail: 'closer@hq.test',
    })
    const run = runSync(world.eventWebhook('Event.1', 'add'))
    await vi.advanceTimersByTimeAsync(STAGE_WAIT_TIMEOUT_MS)
    await run
    expect(world.log).toEqual([])
    expect(world.ghl.appts.size).toBe(0)
    vi.useRealTimers()
  })
})

describe('Account Sync', () => {
  test('an account with no closer is a quiet skip', async () => {
    await accountHandler(
      makeInput(
        {
          entity: 'Account',
          action: 'update',
          data: { id: 'Account.1', resident: {} },
        },
        config
      )
    )
    expect(world.log).toEqual([])
  })
})

describe('Appointment Sync: closer validation', () => {
  function bookWithCloser(email: string) {
    world.addAccount({ accountId: 'Account.1' })
    world.addEvent({
      eventId: 'Event.1',
      accountId: 'Account.1',
      attendeeEmail: email,
    })
    return runSync(world.eventWebhook('Event.1', 'add'))
  }

  test('an unmatched closer email throws before anything is created', async () => {
    await expect(bookWithCloser('nobody@hq.test')).rejects.toThrow('No GoHighLevel user matches')

    expect(world.log).toEqual([])
    expect(world.ghl.contacts.size + world.ghl.appts.size + world.ghl.opps.size).toBe(0)
  })

  test('an ambiguous closer email throws before anything is created', async () => {
    world.ghl.users.push({ id: 'ghl-closer-2', email: 'Closer@hq.test' })

    await expect(bookWithCloser('closer@hq.test')).rejects.toThrow('Multiple GoHighLevel users')

    expect(world.log).toEqual([])
  })

  test('a matched closer creates an assigned appointment and opportunity', async () => {
    await bookWithCloser('closer@hq.test')

    expect([...world.ghl.appts.values()].map((a) => a.assignedUserId)).toEqual(['ghl-closer'])
    expect(world.ghl.opps.size).toBe(1)
    expect(world.terros.events.get('Event.1')!.sourceId).toBeDefined()
  })
})

describe('Appointment Sync: link validation', () => {
  function bookLinked(account: Record<string, unknown>, event: Record<string, unknown> = {}) {
    world.addAccount({ accountId: 'Account.1', ...account })
    world.addEvent({
      eventId: 'Event.1',
      accountId: 'Account.1',
      attendeeEmail: 'closer@hq.test',
      ...event,
    })
    return runSync(world.eventWebhook('Event.1', 'add'))
  }

  test('relinks an externalLeadId that belongs to another location', async () => {
    world.addContact('contact-foreign', { locationId: 'other-location' })

    await bookLinked({ externalLeadId: 'contact-foreign' })

    const relinked = world.terros.accounts.get('Account.1')!.externalLeadId
    expect(relinked).not.toBe('contact-foreign')
    expect(world.ghl.contacts.get(relinked)!.locationId).toBe(LOCATION_ID)
    expect([...world.ghl.appts.values()].map((a) => a.contactId)).toEqual([relinked])
  })

  test('relinks an externalLeadId whose contact no longer exists', async () => {
    await bookLinked({ externalLeadId: 'contact-deleted' })

    const relinked = world.terros.accounts.get('Account.1')!.externalLeadId
    expect(relinked).not.toBe('contact-deleted')
    expect([...world.ghl.appts.values()].map((a) => a.contactId)).toEqual([relinked])
  })

  test('keeps a valid externalLeadId', async () => {
    world.addContact('contact-1')

    await bookLinked({ externalLeadId: 'contact-1' })

    expect(world.terros.accounts.get('Account.1')!.externalLeadId).toBe('contact-1')
    expect(world.terrosWrites().filter((line) => line.includes('account/upsert'))).toEqual([])
  })

  test('a sourceId that is not a GHL appointment creates a new appointment and replaces it', async () => {
    world.addContact('contact-1')

    await bookLinked({ externalLeadId: 'contact-1' }, { sourceId: 'from-another-system' })

    const [created] = [...world.ghl.appts.keys()]
    expect(world.ghl.appts.size).toBe(1)
    expect(world.terros.events.get('Event.1')!.sourceId).toBe(created)
  })

  test('an appointment on a contact that was relinked is recreated on the new contact and the old one cancelled', async () => {
    world.addContact('contact-old', { locationId: 'other-location' })
    world.addAppt('appt-1', 'contact-old')
    world.addAccount({ accountId: 'Account.1', externalLeadId: 'contact-old' })
    world.addEvent({
      eventId: 'Event.1',
      accountId: 'Account.1',
      attendeeEmail: 'closer@hq.test',
      sourceId: 'appt-1',
    })

    await runSync(world.eventWebhook('Event.1', 'update'))

    const relinked = world.terros.accounts.get('Account.1')!.externalLeadId
    const newId = world.terros.events.get('Event.1')!.sourceId
    expect(relinked).not.toBe('contact-old')
    expect(newId).not.toBe('appt-1')
    expect(world.ghl.appts.get(newId)!.contactId).toBe(relinked)
    expect(world.ghl.appts.get('appt-1')!.appointmentStatus).toBe('cancelled')
  })

  test('an existing appointment is updated, not recreated', async () => {
    const event = linkedSetup()
    event.eventDate = '2026-10-07T17:00:00.000Z'

    await runSync(world.eventWebhook('Event.1', 'update'))

    expect(world.ghl.appts.size).toBe(1)
    expect(world.ghl.appts.get('appt-1')!.startTime).toBe('2026-10-07T17:00:00.000Z')
  })
})

describe('Appointment Sync: stage race', () => {
  function book() {
    world.addAccount({ accountId: 'Account.1', workflowStageName: undefined })
    world.addEvent({
      eventId: 'Event.1',
      accountId: 'Account.1',
      attendeeEmail: 'closer@hq.test',
    })
    return runSync(world.eventWebhook('Event.1', 'add'))
  }

  test('creates the appointment right away when the stage is already set', async () => {
    world.addAccount({ accountId: 'Account.1' })
    world.addEvent({
      eventId: 'Event.1',
      accountId: 'Account.1',
      attendeeEmail: 'closer@hq.test',
    })
    await runSync(world.eventWebhook('Event.1', 'add'))
    expect(world.ghl.appts.size).toBe(1)
  })

  test('waits for a stage that appears a few seconds after the event', async () => {
    vi.useFakeTimers()
    const run = book()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(world.ghl.appts.size).toBe(0)
    world.terros.accounts.get('Account.1')!.workflowStageName = 'Appointment Set'
    await vi.advanceTimersByTimeAsync(1_000)
    await run
    expect(world.ghl.appts.size).toBe(1)
    expect(world.ghl.opps.size).toBe(1)
  })
})
