import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handler as accountSync } from './outgoing.ts'
import { CALENDAR_ID, FakeApis, LOCATION_ID, makeInput, PIPELINE_ID } from './fakeApis.ts'
import { decideAttendee } from './closer.ts'
import { handler as appointmentWebhook } from './calendarIncoming.ts'
import { handler as appointmentSync, getAppointmentUpdate, toAppointment } from './calendar.ts'

const config = { locationId: LOCATION_ID, pipelineId: PIPELINE_ID, calendarId: CALENDAR_ID }
const ALERT_URL = 'https://alerts.example.com/hook'

let world: FakeApis
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  world = new FakeApis()
  world.install()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sync = (eventId = 'Event.1') => {
  world.asScript('gohighlevel-appointment-sync')
  return appointmentSync(makeInput(world.eventWebhook(eventId), config))
}
const webhook = (extra: Record<string, unknown> = {}, cfg: Record<string, unknown> = config) => {
  world.asScript('gohighlevel-appointment-webhook')
  return appointmentWebhook(
    makeInput(
      {
        location: { id: LOCATION_ID },
        calendar: {
          id: CALENDAR_ID,
          appointmentId: 'appt-1',
          status: 'confirmed',
          startTime: '2026-10-05T12:00:00',
          endTime: '2026-10-05T13:00:00',
          selectedTimezone: 'America/Chicago',
          ...extra,
        },
      },
      cfg
    )
  )
}

/** A linked consultation. The Terros event is older than the appointment unless a test says otherwise. */
function linked(opts: { attendee?: string; assignee?: string; eventAt?: string; appointmentAt?: string } = {}) {
  world.addAccount({ accountId: 'Account.1', externalLeadId: 'contact-1' })
  world.addContact('contact-1')
  world.addAppt('appt-1', 'contact-1', {
    assignedUserId: opts.assignee ?? 'ghl-closer',
    dateUpdated: opts.appointmentAt ?? '2026-10-01T12:00:10.000Z',
  })
  world.addEvent({
    eventId: 'Event.1',
    accountId: 'Account.1',
    attendeeEmail: opts.attendee ?? 'closer@hq.test',
    sourceId: 'appt-1',
    updatedAt: Date.parse(opts.eventAt ?? '2026-10-01T12:00:00.000Z'),
  })
  world.log.length = 0
}
const attendee = () => world.terros.events.get('Event.1')!.attendeeEmail
const assignee = () => world.ghl.appts.get('appt-1')!.assignedUserId

describe('Appointment Webhook: GoHighLevel reassigns the closer', () => {
  test('sets the Terros attendee through the event upsert, together with the time', async () => {
    linked({ assignee: 'ghl-sales' })

    await webhook()

    expect(attendee()).toBe('sales@hq.test')
    expect(world.terrosWrites()).toHaveLength(1)
    expect(world.terrosWrites()[0]).toContain('"attendeeId":"U.sales"')
    expect(world.ghlWrites()).toEqual([])
  })

  test('does nothing for the closer when the assignee already matches', async () => {
    linked()

    await webhook()

    expect(world.terrosWrites()[0]).not.toContain('attendeeId')
    expect(attendee()).toBe('closer@hq.test')
  })

  test('does nothing for the closer when the appointment has no assignee', async () => {
    linked({ assignee: '' })
    world.ghl.appts.get('appt-1')!.assignedUserId = undefined

    await webhook()

    expect(world.terrosWrites()[0]).not.toContain('attendeeId')
  })

  test('an unmatched email changes nothing and alerts once per event', async () => {
    linked()
    world.ghl.users.push({ id: 'ghl-stranger', email: 'stranger@elsewhere.test' })
    world.ghl.appts.get('appt-1')!.assignedUserId = 'ghl-stranger'
    const posts: unknown[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === ALERT_URL) {
        posts.push(JSON.parse(init!.body as string))
        return new Response('{}')
      }
      return realFetch(url, init)
    })
    const withAlerts = { ...config, alertWebhookUrl: ALERT_URL }

    await webhook({}, withAlerts)
    await webhook({}, withAlerts)

    expect(attendee()).toBe('closer@hq.test')
    expect(world.terrosWrites().filter((w) => w.includes('attendeeId'))).toEqual([])
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ accountId: 'Account.1', eventId: 'Event.1', stage: 'Appointment Webhook' })
    expect(world.terros.accounts.get('Account.1')!.notes).toHaveLength(1)
    // ids only in the log, never the email
    const logged = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logged).toContain('ghl-stranger')
    expect(logged).not.toContain('stranger@elsewhere.test')
  })

  test('keeps the Terros attendee when the Terros event changed after the appointment', async () => {
    linked({ assignee: 'ghl-sales', eventAt: '2026-10-01T12:00:30.000Z', appointmentAt: '2026-10-01T12:00:10.000Z' })

    await webhook()

    expect(attendee()).toBe('closer@hq.test')
  })

  test('a Terros refusal of the attendee still lands the time', async () => {
    linked({ assignee: 'ghl-sales' })
    world.terros.refuseAttendee = 'Closer is not available'

    await webhook()

    expect(attendee()).toBe('closer@hq.test')
    expect(new Date(world.terros.events.get('Event.1')!.eventDate).toISOString()).toBe('2026-10-05T17:00:00.000Z')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('updating the time only'))
  })

  test('without the GoHighLevel token the time still syncs and the closer is skipped', async () => {
    linked({ assignee: 'ghl-sales' })
    world.asScript('gohighlevel-appointment-webhook')
    const input = makeInput(
      {
        location: { id: LOCATION_ID },
        calendar: {
          id: CALENDAR_ID,
          appointmentId: 'appt-1',
          startTime: '2026-10-05T12:00:00',
          endTime: '2026-10-05T13:00:00',
          selectedTimezone: 'America/Chicago',
        },
      },
      config
    )
    input.context.config.secrets = {}

    await appointmentWebhook(input)

    expect(attendee()).toBe('closer@hq.test')
    expect(world.terrosWrites()).toHaveLength(1)
  })

  test('a dry run writes nothing', async () => {
    linked({ assignee: 'ghl-sales' })

    await webhook({}, { ...config, dryRun: 'true' })

    expect(world.log).toEqual([])
  })
})

describe('Appointment Sync: Terros reassigns the closer', () => {
  test('pushes a changed attendee with notifications off', async () => {
    linked({ attendee: 'sales@hq.test', assignee: 'ghl-closer', eventAt: '2026-10-01T12:00:30.000Z' })

    await sync()

    expect(world.ghlWrites()).toEqual([
      'GHL PUT /calendars/events/appointments/appt-1 {"assignedUserId":"ghl-sales","toNotify":false}',
    ])
  })

  test('last writer wins: a GoHighLevel change newer than the Terros event is kept', async () => {
    linked({ attendee: 'sales@hq.test', assignee: 'ghl-closer', eventAt: '2026-10-01T12:00:00.000Z' })

    await sync()

    expect(world.ghlWrites()).toEqual([])
  })

  test('without a Terros time the GoHighLevel assignee is kept', async () => {
    linked({ attendee: 'sales@hq.test', assignee: 'ghl-closer' })
    world.terros.events.get('Event.1')!.updatedAt = undefined

    await sync()

    expect(world.ghlWrites()).toEqual([])
  })

  test('a changed attendee and a new time go in one notified write', async () => {
    linked({ attendee: 'sales@hq.test', assignee: 'ghl-closer', eventAt: '2026-10-01T12:00:30.000Z' })
    world.terros.events.get('Event.1')!.eventDate = '2026-10-06T17:00:00.000Z'

    await sync()

    expect(world.ghlWrites()).toHaveLength(1)
    expect(world.ghlWrites()[0]).toContain('"assignedUserId":"ghl-sales"')
    expect(world.ghlWrites()[0]).toContain('"toNotify":true')
  })

  test('an equal assignee writes nothing and does not read the event', async () => {
    linked({ eventAt: '2026-10-01T12:00:30.000Z' })

    await sync()

    expect(world.ghlWrites()).toEqual([])
  })

  test('getAppointmentUpdate compares by equality and by time', () => {
    const event = { title: 't', eventDate: '2026-10-05T17:00:00.000Z', duration: 60 }
    const input = toAppointment(event, config, 'c', 'ghl-sales')
    const appointment = {
      id: 'a',
      calendarId: 'cal',
      locationId: 'l',
      contactId: 'c',
      title: 't',
      appointmentStatus: 'confirmed',
      startTime: input.startTime,
      endTime: input.endTime,
      assignedUserId: 'ghl-closer',
      dateUpdated: '2026-10-01T12:00:00.000Z',
    }
    const newer = Date.parse('2026-10-01T12:00:01.000Z')
    expect(getAppointmentUpdate(appointment, input, newer)).toEqual({ assignedUserId: 'ghl-sales', toNotify: false })
    expect(getAppointmentUpdate(appointment, input, newer - 2000)).toBeUndefined()
    expect(getAppointmentUpdate(appointment, input)).toBeUndefined()
    expect(getAppointmentUpdate({ ...appointment, assignedUserId: 'ghl-sales' }, input, newer)).toBeUndefined()
  })
})

describe('the two directions converge in one round', () => {
  test('a Terros change is pushed, and its echo from GoHighLevel writes nothing', async () => {
    linked({ attendee: 'sales@hq.test', assignee: 'ghl-closer', eventAt: '2026-10-01T12:00:30.000Z' })

    await sync() // Terros -> GoHighLevel: one write, which stamps the appointment newer than the event
    expect(assignee()).toBe('ghl-sales')
    expect(world.ghlWrites()).toHaveLength(1)
    world.log.length = 0

    await webhook() // the echo: GoHighLevel reports the change it just received
    expect(world.terrosWrites()).toHaveLength(1)
    expect(world.terrosWrites()[0]).not.toContain('attendeeId') // time only, no closer write
    expect(attendee()).toBe('sales@hq.test')
    world.log.length = 0

    await sync() // the echo of that Terros write
    expect(world.log).toEqual([])
    expect(assignee()).toBe('ghl-sales')
  })

  test('a GoHighLevel change is pulled, and its echo from Terros writes nothing', async () => {
    linked({ assignee: 'ghl-sales' })

    await webhook() // GoHighLevel -> Terros: attendee set
    expect(attendee()).toBe('sales@hq.test')
    world.log.length = 0

    await sync() // the echo: Terros event changed after the appointment, but both already name the same closer
    expect(world.log).toEqual([])
    await webhook()
    expect(world.terrosWrites().filter((write) => write.includes('attendeeId'))).toEqual([])
    expect(world.ghlWrites()).toEqual([])
    expect(assignee()).toBe('ghl-sales')
    expect(attendee()).toBe('sales@hq.test')
  })

  test('a simultaneous conflict settles on the newer side and then stays quiet', async () => {
    // Terros chose sales at :30, GoHighLevel chose closer at :20 (older), so Terros wins.
    linked({
      attendee: 'sales@hq.test',
      assignee: 'ghl-closer',
      eventAt: '2026-10-01T12:00:30.000Z',
      appointmentAt: '2026-10-01T12:00:20.000Z',
    })

    await webhook() // GoHighLevel's older change must not overwrite the newer Terros one
    expect(attendee()).toBe('sales@hq.test')
    await sync()
    expect(assignee()).toBe('ghl-sales')
    world.log.length = 0

    await webhook()
    await sync()
    expect(world.log.filter((line) => line.includes('assignedUserId') || line.includes('attendeeId'))).toEqual([])
  })
})

describe('Account Sync leaves the GoHighLevel contact owner alone', () => {
  const save = () => {
    world.asScript('gohighlevel-account-sync')
    return accountSync(makeInput(world.accountWebhook('Account.1'), config))
  }

  test('does not overwrite an owner that was reassigned in GoHighLevel', async () => {
    world.addAccount({ accountId: 'Account.1', externalLeadId: 'c-1', workflowStageName: 'Lead' })
    world.addContact('c-1', { assignedTo: 'ghl-sales' })

    await save()

    const put = world.ghlWrites().find((w) => w.startsWith('GHL PUT /contacts/c-1'))!
    expect(put).not.toContain('assignedTo')
    expect(world.ghl.contacts.get('c-1')!.assignedTo).toBe('ghl-sales')
  })

  test('fills a missing owner', async () => {
    world.addAccount({ accountId: 'Account.1', externalLeadId: 'c-1', workflowStageName: 'Lead' })
    world.addContact('c-1')

    await save()

    expect(world.ghl.contacts.get('c-1')!.assignedTo).toBe('ghl-closer')
  })

  test('sets the owner when it creates the contact', async () => {
    world.addAccount({ accountId: 'Account.1', workflowStageName: 'Lead' })

    await save()

    const [contact] = [...world.ghl.contacts.values()]
    expect(contact!.assignedTo).toBe('ghl-closer')
  })
})

describe('decideAttendee', () => {
  const users = [{ userId: 'U.a' as never, email: 'A@x.test' }]
  test('matches emails ignoring case and refuses an ambiguous match', () => {
    const event = { attendeeId: 'U.b' as never, updatedAt: 1 }
    expect(decideAttendee(event, 'g', { id: 'g', email: ' a@X.test ' }, 2, users)).toEqual({
      change: 'set',
      attendeeId: 'U.a',
    })
    expect(
      decideAttendee(event, 'g', { id: 'g', email: 'a@x.test' }, 2, [
        ...users,
        { userId: 'U.c' as never, email: 'a@x.test' },
      ])
    ).toMatchObject({ change: 'unmatched' })
    expect(decideAttendee(event, 'g', { id: 'g' }, 2, users)).toMatchObject({ change: 'unmatched' })
  })
})
