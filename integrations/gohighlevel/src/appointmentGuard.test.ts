import { afterEach, beforeEach, vi } from 'vitest'
import { handler as accountHandler } from './outgoing.ts'
import { handler as opportunityWebhook } from './incoming.ts'
import { CALENDAR_ID, CONNECT_USER, FakeApis, LOCATION_ID, PIPELINE_ID, makeInput } from './fakeApis.ts'
import { MAX_APPOINTMENT_CREATES, creatingMarker, isFreshMarker } from './creationGuard.ts'
import { handler as appointmentWebhook } from './calendarIncoming.ts'
import { handler as appointmentSync } from './calendar.ts'
import { ALERT_NOTE_PREFIX } from './alerts.ts'

const config = { locationId: LOCATION_ID, calendarId: CALENDAR_ID, pipelineId: PIPELINE_ID }

let world: FakeApis
type Spy = { mock: { calls: unknown[][] } }
let log: Spy
let error: Spy

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  world = new FakeApis()
  world.install()
  world.addContact('contact-1')
  world.addAccount({ accountId: 'Account.1', externalLeadId: 'contact-1' })
  world.addEvent({ eventId: 'Event.1', accountId: 'Account.1', attendeeEmail: 'closer@hq.test' })
})

afterEach(() => {
  expect(world.blocked).toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function runSync(scriptConfig: Record<string, unknown> = config, action: 'add' | 'update' = 'update') {
  world.asScript('gohighlevel-appointment-sync')
  return appointmentSync(makeInput(world.eventWebhook('Event.1', action), scriptConfig))
}

function runWebhook(calendar: Record<string, unknown>, scriptConfig: Record<string, unknown> = config) {
  world.asScript('gohighlevel-appointment-webhook')
  return appointmentWebhook(makeInput({ location: { id: LOCATION_ID }, calendar }, scriptConfig))
}

const appointmentPosts = () =>
  world.ghlWrites().filter((line) => line.startsWith('GHL POST /calendars/events/appointments'))
const alerts = () => error.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('GHL_SYNC_ALERT'))
const logged = () => log.mock.calls.map((call) => String(call[0]))
const sourceId = () => world.terros.events.get('Event.1')!.sourceId

describe('a lookup miss right after create cannot loop', () => {
  test.each(['missing', 'otherContact'] as const)('creates exactly once when the lookup is %s', async (lookup) => {
    world.ghl.appointmentLookup = lookup

    // Each run stands for the webhook that the previous sourceId write triggered.
    for (let run = 0; run < 8; run++) await runSync()

    expect(appointmentPosts()).toHaveLength(1)
    expect(world.ghl.appts.size).toBe(1)
    expect(sourceId()).toBe([...world.ghl.appts.keys()][0])
    expect(world.ghlWrites().filter((line) => line.includes('cancelled'))).toEqual([])
    expect(alerts()).toHaveLength(7)
  })

  test('the alert says what was not done', async () => {
    world.ghl.appointmentLookup = 'missing'

    await runSync()
    await runSync()

    expect(alerts()[0]).toContain('was not found, so no appointment was created or changed')
    expect(alerts()[0]).toContain('"eventId":"Event.1"')
  })

  test('a miss logs the HTTP status for the lookup', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.ghl.appointmentLookup = 'missing'
    world.terros.events.get('Event.1')!.sourceId = 'appt-1'

    await runSync()

    expect(logged()).toContain('GoHighLevel appointment lookup for appt-1 returned HTTP 404')
  })

  test.each(['liveShape', 'normal'] as const)('reads a linked appointment from the %s reply', async (lookup) => {
    world.addAppt('appt-1', 'contact-1')
    world.ghl.appointmentLookup = lookup
    world.terros.events.get('Event.1')!.sourceId = 'appt-1'

    await runSync()

    expect(alerts()).toEqual([])
    expect(logged().some((line) => line.includes('without an event'))).toBe(false)
  })

  test('a reply with neither appointment nor event is a miss that logs its keys', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.ghl.appointmentLookup = 'noAppointment'
    world.terros.events.get('Event.1')!.sourceId = 'appt-1'

    await runSync()

    expect(logged()).toContain(
      'GoHighLevel appointment lookup for appt-1 returned HTTP 200 without an event; top-level keys: traceId'
    )
    expect(alerts()).toHaveLength(1)
  })

  test('a refusal writes nothing to Terros or GoHighLevel', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.ghl.appointmentLookup = 'missing'
    world.terros.events.get('Event.1')!.sourceId = 'appt-1'

    await runSync()

    expect(world.log).toEqual([])
  })
})

describe('creation marker', () => {
  test('a fresh marker means a create is in flight, so the run skips', async () => {
    world.terros.events.get('Event.1')!.sourceId = creatingMarker(Date.now())

    await runSync()

    expect(world.log).toEqual([])
    expect(world.ghl.appts.size).toBe(0)
  })

  test('an expired marker counts as absent and is replaced by the real id', async () => {
    world.terros.events.get('Event.1')!.sourceId = creatingMarker(Date.now() - 120_000)

    await runSync()

    expect(appointmentPosts()).toHaveLength(1)
    expect(sourceId()).toBe([...world.ghl.appts.keys()][0])
  })

  test('freshness is judged from the timestamp, and malformed markers are not fresh', () => {
    const now = 1_000_000_000
    expect(isFreshMarker(creatingMarker(now - 30_000), now)).toBe(true)
    expect(isFreshMarker(creatingMarker(now - 61_000), now)).toBe(false)
    expect(isFreshMarker('pending:garbage', now)).toBe(false)
    expect(isFreshMarker('real-appointment-id', now)).toBe(false)
    expect(isFreshMarker(undefined, now)).toBe(false)
  })

  test('the marker is written before the POST and replaced by the appointment id', async () => {
    await runSync(config, 'add')

    const writes = world.log.filter(
      (line) => line.includes('calendar/event/update') || line.includes('POST /calendars')
    )
    expect(writes).toHaveLength(3)
    expect(writes[0]).toMatch(/"sourceId":"pending:\d+:/)
    expect(writes[1]).toContain('GHL POST /calendars/events/appointments')
    expect(writes[2]).toMatch(/"sourceId":"appt-\d+"/)
  })

  test('a run that loses the claim does not create', async () => {
    world.terros.stealClaimWith = creatingMarker(Date.now())

    await runSync()

    expect(appointmentPosts()).toEqual([])
    expect(world.terrosWrites().filter((line) => line.includes('notes'))).toEqual([])
  })

  test('a Terros removal with a marker as sourceId does not look up or cancel an appointment', async () => {
    world.terros.events.get('Event.1')!.sourceId = creatingMarker(Date.now())
    world.asScript('gohighlevel-appointment-sync')

    await appointmentSync(makeInput(world.removeWebhook('Event.1'), config))

    expect(world.log).toEqual([])
    expect(logged().some((line) => line.includes('no GoHighLevel appointment'))).toBe(true)
  })

  test('the GoHighLevel webhook ignores a marker passed as an appointment id', async () => {
    const event = world.terros.events.get('Event.1')!
    event.sourceId = creatingMarker(Date.now())

    await runWebhook({
      id: CALENDAR_ID,
      appointmentId: event.sourceId,
      status: 'confirmed',
      startTime: '2026-10-06T10:00:00',
      endTime: '2026-10-06T11:00:00',
      selectedTimezone: 'America/Chicago',
    })

    expect(world.terrosWrites()).toEqual([])
  })
})

describe('per-event create cap', () => {
  test(`never creates more than ${MAX_APPOINTMENT_CREATES} appointments for one event, even if the link keeps vanishing`, async () => {
    for (let run = 0; run < 6; run++) {
      world.terros.events.get('Event.1')!.sourceId = undefined
      await runSync()
    }

    expect(appointmentPosts()).toHaveLength(MAX_APPOINTMENT_CREATES)
    expect(alerts()).toHaveLength(6 - MAX_APPOINTMENT_CREATES)
    expect(alerts()[0]).toContain('create attempts, so no more were made')
  })

  test('the count is kept on the account as bookkeeping notes that are not synced to GoHighLevel', async () => {
    await runSync()

    const notes = world.terros.accounts.get('Account.1')!.notes as { text: string; userId: string }[]
    expect(notes).toHaveLength(1)
    expect(notes[0]!.text.startsWith(ALERT_NOTE_PREFIX)).toBe(true)
    expect(notes[0]!.text).toContain('Event.1')
    expect(notes[0]!.userId).toBe('U.owner')
  })

  test('another event on the same account has its own count', async () => {
    world.addEvent({ eventId: 'Event.2', accountId: 'Account.1', attendeeEmail: 'closer@hq.test' })
    for (let run = 0; run < MAX_APPOINTMENT_CREATES; run++) {
      world.terros.events.get('Event.1')!.sourceId = undefined
      await runSync()
    }
    world.asScript('gohighlevel-appointment-sync')

    await appointmentSync(makeInput(world.eventWebhook('Event.2', 'add'), config))

    expect(appointmentPosts()).toHaveLength(MAX_APPOINTMENT_CREATES + 1)
  })

  test('without an owner or closer to record the attempt under, it refuses to create', async () => {
    world.terros.accounts.get('Account.1')!.ownerId = undefined
    const webhook = world.eventWebhook('Event.1', 'update')
    const payload = { ...webhook, data: { ...webhook.data, attendee: { email: 'closer@hq.test' } } }
    world.asScript('gohighlevel-appointment-sync')

    await appointmentSync(makeInput(payload, config))

    expect(appointmentPosts()).toEqual([])
    expect(alerts()[0]).toContain('no owner or closer')
  })
})

describe('kill switch', () => {
  test.each([true, 'true', ' TRUE '])('Appointment Sync does nothing when disabled is %j', async (disabled) => {
    await runSync({ ...config, disabled })

    expect(world.log).toEqual([])
    expect(world.ghl.appts.size).toBe(0)
  })

  test('Appointment Sync does nothing on a remove either', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.asScript('gohighlevel-appointment-sync')

    await appointmentSync(
      makeInput(
        { entity: 'Event', action: 'remove', data: { id: 'Event.1', sourceId: 'appt-1' } },
        { ...config, disabled: 'true' }
      )
    )

    expect(world.log).toEqual([])
  })

  test('is off by default and for false', async () => {
    await runSync({ ...config, disabled: 'false' })

    expect(appointmentPosts()).toHaveLength(1)
  })

  test('Appointment Webhook, Account Sync and Opportunity Webhook honor it', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.terros.events.get('Event.1')!.sourceId = 'appt-1'

    await runWebhook(
      { id: CALENDAR_ID, appointmentId: 'appt-1', status: 'cancelled', selectedTimezone: 'UTC' },
      { ...config, disabled: 'true' }
    )
    await accountHandler(makeInput(world.accountWebhook('Account.1'), { ...config, disabled: 'true' }))
    await opportunityWebhook(
      makeInput(
        { location: { id: LOCATION_ID }, contact_id: 'contact-1', customData: { pipeline_stage: 'Lead' } },
        { ...config, disabled: 'true' }
      )
    )

    expect(world.log).toEqual([])
    expect(world.terros.events.has('Event.1')).toBe(true)
  })
})

describe('dry run', () => {
  test('Appointment Sync logs what it would create and writes nothing', async () => {
    world.terros.accounts.get('Account.1')!.externalLeadId = undefined

    await runSync({ ...config, dryRun: 'true' })

    expect(world.log).toEqual([])
    expect(world.ghl.appts.size).toBe(0)
    expect(world.ghl.contacts.size).toBe(1)
    expect(logged().some((line) => line.startsWith('DRY RUN: would create a GoHighLevel appointment'))).toBe(true)
  })

  test('Appointment Sync logs the update it would make to an existing appointment', async () => {
    world.addAppt('appt-1', 'contact-1')
    const event = world.terros.events.get('Event.1')!
    event.sourceId = 'appt-1'
    event.eventDate = '2026-10-07T17:00:00.000Z'

    await runSync({ ...config, dryRun: true })

    expect(world.log).toEqual([])
    expect(logged().some((line) => line.startsWith('DRY RUN: would update GoHighLevel appointment appt-1'))).toBe(true)
  })

  test('Appointment Sync logs the cancel it would make', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.asScript('gohighlevel-appointment-sync')

    await appointmentSync(
      makeInput(
        { entity: 'Event', action: 'remove', data: { id: 'Event.1', sourceId: 'appt-1' } },
        { ...config, dryRun: 'true' }
      )
    )

    expect(world.log).toEqual([])
    expect(logged().some((line) => line.startsWith('DRY RUN: would cancel'))).toBe(true)
  })

  test('Appointment Webhook logs the removal it would make', async () => {
    world.addAppt('appt-1', 'contact-1')
    world.terros.events.get('Event.1')!.sourceId = 'appt-1'

    await runWebhook(
      { id: CALENDAR_ID, appointmentId: 'appt-1', status: 'cancelled', selectedTimezone: 'UTC' },
      { ...config, dryRun: 'true' }
    )

    expect(world.terrosWrites()).toEqual([])
    expect(world.terros.events.has('Event.1')).toBe(true)
    expect(logged().some((line) => line.startsWith('DRY RUN: would remove Event.1'))).toBe(true)
  })

  test('Account Sync and Opportunity Webhook write nothing', async () => {
    await accountHandler(makeInput(world.accountWebhook('Account.1'), { ...config, dryRun: 'true' }))
    await opportunityWebhook(
      makeInput(
        { location: { id: LOCATION_ID }, contact_id: 'contact-1', customData: { pipeline_stage: 'Lead' } },
        { ...config, dryRun: 'true' }
      )
    )

    expect(world.log).toEqual([])
  })
})

describe('Appointment Webhook without company:read', () => {
  test('logs a clear message and carries on instead of failing', async () => {
    world.addAppt('appt-1', 'contact-1')
    const event = world.terros.events.get('Event.1')!
    event.sourceId = 'appt-1'
    event.ownerId = CONNECT_USER
    world.asScript('gohighlevel-appointment-webhook')
    world.permissions!.delete('company:read')

    await appointmentWebhook(
      makeInput(
        {
          location: { id: LOCATION_ID },
          calendar: {
            id: CALENDAR_ID,
            appointmentId: 'appt-1',
            status: 'confirmed',
            startTime: '2026-10-06T10:00:00',
            endTime: '2026-10-06T11:30:00',
            selectedTimezone: 'America/Chicago',
          },
        },
        config
      )
    )

    expect(error.mock.calls.map((call) => String(call[0])).join('\n')).toContain('Could not read the company')
    expect(new Date(event.eventDate).toISOString()).toBe('2026-10-06T15:00:00.000Z')
  })
})
