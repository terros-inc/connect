import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handler as resync, errorReason, readSettings } from './resync.ts'
import { CALENDAR_ID, FakeApis, LOCATION_ID, makeInput, PIPELINE_ID } from './fakeApis.ts'
import { createNoteText, MAX_APPOINTMENT_CREATES } from './creationGuard.ts'

const ALERT_URL = 'https://alerts.example.com/hook'
const config = {
  locationId: LOCATION_ID,
  pipelineId: PIPELINE_ID,
  calendarId: CALENDAR_ID,
  alertWebhookUrl: ALERT_URL,
}
const NOW = '2026-10-02T12:00:00.000Z'

let world: FakeApis
let alertPosts: { text: string }[]
let log: { mock: { calls: unknown[][] } }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  world = new FakeApis()
  world.install()
  alertPosts = []
  const fakeFetch = fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === ALERT_URL) {
      alertPosts.push(JSON.parse(init!.body as string))
      return new Response('{}')
    }
    return fakeFetch(url, init)
  })
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  expect(world.blocked).toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function run(overrides: Record<string, unknown> = {}, payload?: Record<string, unknown>) {
  world.asScript('gohighlevel-resync')
  return resync(makeInput(payload, { ...config, ...overrides }))
}

const lines = (marker: string) =>
  log.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(`${marker} `))
    .map((line) => JSON.parse(line.slice(marker.length + 1)))
const records = () => lines('GHL_RESYNC')
const summary = () => lines('GHL_RESYNC_SUMMARY').at(-1)
const actions = () => records().map((record) => `${record.id} ${record.action} ${record.reason}`)
const appointmentPosts = () =>
  world.ghlWrites().filter((line) => line.startsWith('GHL POST /calendars/events/appointments'))

function addUnsyncedEvent(n = 1, extra: Record<string, unknown> = {}) {
  world.addContact(`contact-${n}`, { email: `home${n}@home.test` })
  world.addAccount({
    accountId: `Account.${n}`,
    externalLeadId: `contact-${n}`,
    resident: { firstName: 'Test', lastName: 'Homeowner', email: `home${n}@home.test`, phone: '+15125550123' },
  })
  return world.addEvent({
    eventId: `Event.${n}`,
    accountId: `Account.${n}`,
    attendeeEmail: 'closer@hq.test',
    eventDate: `2026-10-0${2 + n}T17:00:00.000Z`,
    ...extra,
  })
}

describe('report mode (the default)', () => {
  test('logs what it would create and writes nothing anywhere', async () => {
    addUnsyncedEvent(1)
    world.addContact('c-acct')
    world.addAccount({ accountId: 'Account.A', externalLeadId: 'c-acct' })

    await run()

    expect(actions()).toEqual([
      'Event.1 would_create no_appointment_link',
      // Both accounts are in the default stage with a contact and no opportunity.
      'Account.1 would_create no_opportunity',
      'Account.A would_create no_opportunity',
    ])
    expect(world.log).toEqual([])
    expect(world.ghl.appts.size).toBe(0)
    expect(world.ghl.opps.size).toBe(0)
    expect(summary()).toMatchObject({ mode: 'report', wrote: false, would_create: 3, created: 0, more: false })
  })

  test('anything but "repair" is report, so a typo writes nothing', async () => {
    addUnsyncedEvent(1)
    await run({ mode: 'repiar' })
    expect(summary()).toMatchObject({ mode: 'report', wrote: false })
    expect(world.log).toEqual([])
  })

  test('dryRun holds repair back', async () => {
    addUnsyncedEvent(1)
    await run({ mode: 'repair', dryRun: 'true' })
    expect(summary()).toMatchObject({ mode: 'repair', dryRun: true, wrote: false })
    expect(records()[0]).toMatchObject({ action: 'would_create' })
    expect(world.log).toEqual([])
  })

  test('disabled does nothing at all', async () => {
    addUnsyncedEvent(1)
    await run({ mode: 'repair', disabled: 'true' })
    expect(world.log).toEqual([])
    expect(records()).toEqual([])
    expect(alertPosts).toEqual([])
  })
})

describe('repair mode: appointments', () => {
  test('creates the missing appointment silently, links it and records the attempt', async () => {
    addUnsyncedEvent(1)

    await run({ mode: 'repair' })

    expect(appointmentPosts()).toHaveLength(1)
    const [appointment] = [...world.ghl.appts.values()]
    expect(appointment).toMatchObject({ contactId: 'contact-1', assignedUserId: 'ghl-closer', toNotify: false })
    expect(world.terros.events.get('Event.1')!.sourceId).toBe(appointment!.id)
    expect(world.terros.accounts.get('Account.1')!.notes.map((note: { text: string }) => note.text)).toContain(
      createNoteText('Event.1', 'Account.1')
    )
    expect(records()).toContainEqual(expect.objectContaining({ id: 'Event.1', action: 'created' }))
  })

  test('a second run creates nothing', async () => {
    addUnsyncedEvent(1)
    await run({ mode: 'repair' })
    const afterFirst = world.log.length

    await run({ mode: 'repair' })

    expect(world.log).toHaveLength(afterFirst)
    expect(world.ghl.appts.size).toBe(1)
    expect(actions()).toContain('Event.1 skipped in_sync')
  })

  test.each(['missing', 'noAppointment'] as const)(
    'a lookup miss (%s) never creates over a link, however often it runs',
    async (lookup) => {
      world.addContact('contact-1')
      world.addAccount({ accountId: 'Account.1', externalLeadId: 'contact-1', workflowStageName: 'Sat' })
      world.addAppt('appt-1', 'contact-1')
      world.addEvent({
        eventId: 'Event.1',
        accountId: 'Account.1',
        attendeeEmail: 'closer@hq.test',
        sourceId: 'appt-1',
      })
      world.ghl.appointmentLookup = lookup

      for (let i = 0; i < 4; i++) await run({ mode: 'repair' })

      expect(appointmentPosts()).toEqual([])
      expect(world.ghl.appts.size).toBe(1)
      expect(world.terros.events.get('Event.1')!.sourceId).toBe('appt-1')
      expect(world.terrosWrites()).toEqual([])
      expect(world.log).toEqual([])
      expect(actions()).toEqual(Array(4).fill('Event.1 skipped linked_appointment_not_found'))
      expect(summary()).toMatchObject({ linkMissing: 1, created: 0 })
    }
  )

  test('leaves a linked, found appointment alone', async () => {
    world.addContact('contact-1')
    world.addAccount({ accountId: 'Account.1', externalLeadId: 'contact-1', workflowStageName: 'Sat' })
    world.addAppt('appt-1', 'contact-1')
    world.addEvent({ eventId: 'Event.1', accountId: 'Account.1', attendeeEmail: 'closer@hq.test', sourceId: 'appt-1' })

    await run({ mode: 'repair' })

    expect(world.log).toEqual([])
    expect(actions()).toEqual(['Event.1 skipped in_sync'])
  })

  test('never touches a past event, or one beyond the horizon', async () => {
    addUnsyncedEvent(1, { eventDate: '2026-10-01T17:00:00.000Z' })
    addUnsyncedEvent(2, { eventDate: '2026-10-20T17:00:00.000Z' })
    for (const id of ['Account.1', 'Account.2']) world.terros.accounts.get(id)!.workflowStageName = 'Sat'

    await run({ mode: 'repair' })

    expect(records().filter((record) => record.kind === 'appointment')).toEqual([])
    expect(world.log).toEqual([])

    await run({ mode: 'repair' }, { horizonDays: 30 })
    expect(actions()).toEqual(['Event.2 created no_appointment_link'])
  })

  test('only Consultation events with an account and a closer are considered', async () => {
    addUnsyncedEvent(1, { eventType: 'Comeback' })
    addUnsyncedEvent(2, { accountId: undefined })
    addUnsyncedEvent(3, { attendeeEmail: undefined })
    for (const id of ['Account.1', 'Account.2', 'Account.3']) world.terros.accounts.get(id)!.workflowStageName = 'Sat'

    await run({ mode: 'repair' })

    expect(actions()).toEqual(['Event.2 skipped no_account', 'Event.3 skipped no_attendee'])
    expect(world.log).toEqual([])
  })

  test('a fresh create marker means a create is in flight, so it waits', async () => {
    addUnsyncedEvent(1, { sourceId: `pending:${Date.now()}:abc` })
    world.terros.accounts.get('Account.1')!.workflowStageName = 'Sat'

    await run({ mode: 'repair' })

    expect(actions()).toEqual(['Event.1 skipped create_in_flight'])
    expect(world.log).toEqual([])
  })

  test('the per-event create limit still applies', async () => {
    addUnsyncedEvent(1)
    world.terros.accounts.get('Account.1')!.workflowStageName = 'Sat'
    world.terros.accounts.get('Account.1')!.notes = Array.from({ length: MAX_APPOINTMENT_CREATES }, () => ({
      text: createNoteText('Event.1', 'Account.1'),
    }))

    await run({ mode: 'repair' })

    expect(actions()).toEqual(['Event.1 skipped create_limit'])
    expect(appointmentPosts()).toEqual([])
  })

  test('a closer with no GoHighLevel user is skipped, not created unassigned', async () => {
    addUnsyncedEvent(1, { attendeeEmail: 'nobody@hq.test' })
    world.terros.accounts.get('Account.1')!.workflowStageName = 'Sat'

    await run({ mode: 'repair' })

    expect(actions()).toEqual(['Event.1 skipped no_ghl_user'])
    expect(world.log).toEqual([])
  })

  test('creates the contact when the account has none', async () => {
    addUnsyncedEvent(1)
    world.terros.accounts.get('Account.1')!.externalLeadId = undefined
    world.terros.accounts.get('Account.1')!.workflowStageName = 'Sat'
    world.ghl.contacts.clear()

    await run({ mode: 'repair' })

    const [contact] = [...world.ghl.contacts.values()]
    expect(world.terros.accounts.get('Account.1')!.externalLeadId).toBe(contact!.id)
    expect([...world.ghl.appts.values()]).toEqual([expect.objectContaining({ contactId: contact!.id })])
  })
})

describe('repair mode: accounts', () => {
  const account = (extra: Record<string, unknown> = {}) =>
    world.addAccount({ accountId: 'Account.A', externalLeadId: 'c-1', ...extra })

  test('creates the missing opportunity in the stage of the account and saves its id', async () => {
    world.addContact('c-1')
    account()

    await run({ mode: 'repair', opportunityIdFieldId: 'CF.opp' })

    expect([...world.ghl.opps.values()]).toEqual([
      expect.objectContaining({
        contactId: 'c-1',
        pipelineStageId: 'st-appt',
        status: 'open',
        assignedTo: 'ghl-closer',
      }),
    ])
    expect(world.terros.accounts.get('Account.A')!.customFields['CF.opp']).toBe([...world.ghl.opps.keys()][0])
    expect(actions()).toEqual(['Account.A created opportunity'])
  })

  test('creates the contact and the opportunity for an account that has neither', async () => {
    account({ externalLeadId: undefined })

    await run({ mode: 'repair' })

    const [contact] = [...world.ghl.contacts.values()]
    expect(world.terros.accounts.get('Account.A')!.externalLeadId).toBe(contact!.id)
    expect([...world.ghl.opps.values()]).toEqual([expect.objectContaining({ contactId: contact!.id })])
    expect(actions()).toEqual(['Account.A created contact_and_opportunity'])
  })

  test('uses stageMappings and the configured opportunity stages like Account Sync', async () => {
    world.addContact('c-1')
    world.addContact('c-2')
    account({ workflowStageName: 'Closed Won' })
    world.addAccount({ accountId: 'Account.B', externalLeadId: 'c-2', workflowStageName: 'Lead' })

    await run({ mode: 'repair', opportunityStages: 'Closed Won', stageMappings: { 'Closed Won': 'Sat' } })

    expect([...world.ghl.opps.values()].map((opp) => [opp.contactId, opp.pipelineStageId])).toEqual([['c-1', 'st-sat']])
  })

  test('skips an account with no closer and one outside the configured stages, creating no contact', async () => {
    account({ closer: undefined, closerId: undefined })
    world.addAccount({ accountId: 'Account.B', workflowStageName: 'Lead' })

    await run({ mode: 'repair' })

    expect(actions()).toEqual(['Account.A skipped no_closer'])
    expect(world.log).toEqual([])
    expect(world.ghl.contacts.size).toBe(0)
  })

  test('leaves an existing opportunity untouched, whatever its stage or owner', async () => {
    world.addContact('c-1')
    account()
    world.addOpp('opp-1', 'c-1', 'st-won', { assignedTo: undefined })

    await run({ mode: 'repair' })

    expect(world.log).toEqual([])
    expect(world.ghl.opps.get('opp-1')).toMatchObject({ pipelineStageId: 'st-won' })
    expect(actions()).toEqual(['Account.A skipped in_sync'])
  })

  test('a linked account that already holds its opportunity id costs nothing', async () => {
    account({ customFields: { 'CF.opp': 'opp-1' } })

    await run({ mode: 'repair', opportunityIdFieldId: 'CF.opp' })

    expect(records()).toEqual([])
    expect(summary()).toMatchObject({ accountsScanned: 1, accountsInScope: 1 })
  })

  test('a second run creates nothing', async () => {
    account({ externalLeadId: undefined })
    addUnsyncedEvent(1)
    await run({ mode: 'repair' })
    const afterFirst = world.log.length
    const [contacts, opps, appts] = [world.ghl.contacts.size, world.ghl.opps.size, world.ghl.appts.size]

    await run({ mode: 'repair' })

    expect(world.log).toHaveLength(afterFirst)
    expect([world.ghl.contacts.size, world.ghl.opps.size, world.ghl.appts.size]).toEqual([contacts, opps, appts])
    expect(summary()).toMatchObject({ created: 0, would_create: 0, errors: 0, more: false })
  })

  test('a failure is one error line and the run carries on', async () => {
    world.addContact('c-1')
    world.addContact('c-2')
    account()
    world.addAccount({ accountId: 'Account.B', externalLeadId: 'c-2' })
    world.ghl.failNext.set('POST /opportunities/', 500)

    await run({ mode: 'repair' })

    expect(actions()).toEqual(['Account.A error ghl_http_500', 'Account.B created opportunity'])
    expect(summary()).toMatchObject({ errors: 1, created: 1 })
  })
})

describe('the cap and the time budget', () => {
  test('stops at maxRecords and a later run carries on until nothing remains', async () => {
    for (const n of [1, 2, 3, 4, 5]) addUnsyncedEvent(n)
    for (const id of [1, 2, 3, 4, 5]) world.terros.accounts.get(`Account.${id}`)!.workflowStageName = 'Sat'

    await run({ mode: 'repair', maxRecords: '2' })
    expect(appointmentPosts()).toHaveLength(2)
    expect(summary()).toMatchObject({ created: 2, more: true })

    await run({ mode: 'repair', maxRecords: '2' })
    expect(appointmentPosts()).toHaveLength(4)
    expect(summary()).toMatchObject({ created: 2, more: true })

    await run({ mode: 'repair', maxRecords: '2' })
    expect(appointmentPosts()).toHaveLength(5)
    expect(summary()).toMatchObject({ created: 1, more: false })

    // Soonest first: events are created in date order.
    expect([...world.ghl.appts.values()].map((appt) => appt.startTime)).toEqual(
      [3, 4, 5, 6, 7].map((day) => `2026-10-0${day}T17:00:00.000Z`)
    )
  })

  test('the default cap is 25', () => {
    expect(readSettings({} as never, undefined)).toMatchObject({
      maxRecords: 25,
      horizonDays: 14,
      timeBudgetMs: 40_000,
    })
  })

  test('a request body can change the mode, horizon and cap for one run, and nothing else', async () => {
    addUnsyncedEvent(1)
    addUnsyncedEvent(2)
    for (const id of ['Account.1', 'Account.2']) world.terros.accounts.get(id)!.workflowStageName = 'Sat'

    await run({ dryRun: 'true' }, { mode: 'repair', maxRecords: 1, dryRun: 'false', disabled: 'false' })

    // The payload asked for repair, but dryRun in the install config still holds.
    expect(summary()).toMatchObject({ mode: 'repair', dryRun: true, wrote: false, would_create: 1, more: true })
    expect(world.log).toEqual([])
  })

  test('stops starting records when the time budget is spent', async () => {
    for (const n of [1, 2, 3, 4]) addUnsyncedEvent(n)
    for (const id of [1, 2, 3, 4]) world.terros.accounts.get(`Account.${id}`)!.workflowStageName = 'Sat'
    // Each GoHighLevel call takes 2 s of the run.
    const inner = fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('leadconnectorhq')) vi.setSystemTime(Date.now() + 2000)
      return inner(url, init)
    })

    await run({ mode: 'repair', timeBudgetSeconds: '5' })

    // The first event takes 4 GoHighLevel calls (two for the closer, the contact check, the POST): 8 s, over the budget.
    expect(appointmentPosts()).toHaveLength(1)
    expect(summary()).toMatchObject({ more: true })
  })
})

describe('the log and the summary', () => {
  test('log lines hold ids and codes only, never names, emails or phones', async () => {
    addUnsyncedEvent(1)
    world.addContact('c-a')
    world.addAccount({ accountId: 'Account.A', externalLeadId: 'c-a' })
    world.ghl.failNext.set('POST /opportunities/', 500)

    await run({ mode: 'repair' })

    const everything = log.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('GHL_RESYNC'))
    expect(everything.length).toBeGreaterThan(0)
    for (const line of everything) {
      expect(line).not.toMatch(/Homeowner|home\d@home\.test|@hq\.test|5125550123|Austin|Main St/)
    }
    for (const record of records())
      expect(Object.keys(record).sort()).toEqual(['action', 'id', 'kind', 'mode', 'reason'])
  })

  test('sends the counts through the alert webhook', async () => {
    addUnsyncedEvent(1)
    world.terros.accounts.get('Account.1')!.workflowStageName = 'Sat'

    await run()

    expect(alertPosts).toHaveLength(1)
    expect(alertPosts[0]!.text).toContain('GoHighLevel Resync (report): would create 1')
    expect(alertPosts[0]!.text).toContain('Nothing was written')
    expect(alertPosts[0]).not.toHaveProperty('accountId')
  })

  test('the summary says whether more remain', async () => {
    addUnsyncedEvent(1)
    addUnsyncedEvent(2)
    for (const id of ['Account.1', 'Account.2']) world.terros.accounts.get(id)!.workflowStageName = 'Sat'

    await run({}, { maxRecords: 1 })

    expect(alertPosts[0]!.text).toContain('More remain')
    expect(summary()).toMatchObject({ more: true })
  })

  test('error reasons keep only the status of a GoHighLevel failure', () => {
    expect(errorReason(Error('GHL request failed: 422 Unprocessable {"email":"a@b.test"}'))).toBe('ghl_http_422')
    expect(errorReason(Error('boom for a@b.test'))).toBe('unexpected_error')
  })
})
