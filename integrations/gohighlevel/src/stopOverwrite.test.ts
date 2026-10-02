import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handler as accountSync } from './outgoing.ts'
import { handler as opportunityWebhook } from './incoming.ts'
import { CALENDAR_ID, FakeApis, LOCATION_ID, makeInput, PIPELINE_ID } from './fakeApis.ts'
import { handler as appointmentSync } from './calendar.ts'

const config = { locationId: LOCATION_ID, pipelineId: PIPELINE_ID, calendarId: CALENDAR_ID, stageMappings: {} }
let fake: FakeApis
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fake = new FakeApis()
  fake.install()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const syncAccount = (id = 'Account.1') => accountSync(makeInput(fake.accountWebhook(id), config))
const syncEvent = (id = 'Event.1', action: 'add' | 'update' = 'update') =>
  appointmentSync(makeInput(fake.eventWebhook(id, action), config))
const hookOpportunity = (stage: string, cfg: Record<string, unknown> = config) =>
  opportunityWebhook(
    makeInput({ location: { id: LOCATION_ID }, contact_id: 'c-1', customData: { pipeline_stage: stage } }, cfg)
  )

/** Terros account and consultation already linked to a GoHighLevel contact, appointment and opportunity. */
function linked(opportunity: Record<string, unknown> = {}, appointment: Record<string, unknown> = {}) {
  fake.addAccount({ accountId: 'Account.1', workflowStageName: 'Appointment Set', externalLeadId: 'c-1' })
  fake.addEvent({ eventId: 'Event.1', accountId: 'Account.1', attendeeEmail: 'closer@hq.test', sourceId: 'appt-1' })
  fake.addContact('c-1')
  fake.addOpp('opp-1', 'c-1', 'st-sat', opportunity)
  fake.addAppt('appt-1', 'c-1', appointment)
  fake.log.length = 0
}

describe('fake APIs', () => {
  test('refuse any host other than the two fakes', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow('NETWORK BLOCKED')
    expect(fake.blocked).toEqual(['https://example.com/'])
  })
})

describe('Account Sync leaves an existing opportunity to GoHighLevel', () => {
  test.each(['open', 'won', 'lost', 'abandoned'])(
    'does not write stage, status, name or owner on a %s opportunity',
    async (status) => {
      linked({ status, name: 'Renamed in GHL', assignedTo: 'ghl-sales' })
      await syncAccount()
      expect(fake.ghlWrites().filter((line) => line.includes('/opportunities'))).toEqual([])
      expect(fake.ghl.opps.get('opp-1')).toMatchObject({ pipelineStageId: 'st-sat', status, assignedTo: 'ghl-sales' })
    }
  )

  test('sets only the owner when the opportunity has none', async () => {
    linked({ assignedTo: undefined, status: 'won' })
    await syncAccount()
    expect(fake.ghlWrites().filter((line) => line.includes('/opportunities'))).toEqual([
      'GHL PUT /opportunities/opp-1 {"assignedTo":"ghl-closer"}',
    ])
    expect(fake.ghl.opps.get('opp-1')).toMatchObject({ pipelineStageId: 'st-sat', status: 'won' })
  })

  test('still creates a new opportunity at the mapped stage', async () => {
    fake.addAccount({ accountId: 'Account.1', workflowStageName: 'Appointment Set' })
    await syncAccount()
    expect([...fake.ghl.opps.values()]).toEqual([
      expect.objectContaining({
        pipelineStageId: 'st-appt',
        status: 'open',
        assignedTo: 'ghl-closer',
        name: 'Test Homeowner',
      }),
    ])
  })
})

describe('Appointment Sync leaves an existing opportunity and appointment to GoHighLevel', () => {
  test('does not move, reopen, rename or reassign an existing opportunity', async () => {
    linked({ status: 'lost', name: 'Renamed in GHL', assignedTo: 'ghl-sales' })
    await syncEvent()
    expect(fake.ghlWrites().filter((line) => line.includes('/opportunities'))).toEqual([])
    expect(fake.ghl.opps.get('opp-1')).toMatchObject({
      pipelineStageId: 'st-sat',
      status: 'lost',
      assignedTo: 'ghl-sales',
    })
  })

  test('creates only the appointment for a new consultation', async () => {
    fake.addAccount({ accountId: 'Account.1', workflowStageName: 'Appointment Set' })
    fake.addEvent({ eventId: 'Event.1', accountId: 'Account.1', attendeeEmail: 'closer@hq.test' })
    await syncEvent('Event.1', 'add')
    expect([...fake.ghl.appts.values()]).toEqual([
      expect.objectContaining({ appointmentStatus: 'confirmed', toNotify: true, assignedUserId: 'ghl-closer' }),
    ])
    expect(fake.ghl.opps.size).toBe(0)
  })

  test('does not write appointment status, title or assignee when only those differ', async () => {
    linked({}, { appointmentStatus: 'showed', title: 'Renamed in GHL', assignedUserId: 'ghl-sales' })
    await syncEvent()
    expect(fake.ghlWrites()).toEqual([])
  })

  test('reschedule sends only the new time, notifies, and keeps status and assignee', async () => {
    linked({}, { appointmentStatus: 'showed', assignedUserId: 'ghl-sales' })
    fake.terros.events.get('Event.1')!.eventDate = '2026-10-06T17:00:00.000Z'
    await syncEvent()
    const writes = fake.ghlWrites().filter((line) => line.includes('/appointments'))
    expect(writes).toHaveLength(1)
    const body = JSON.parse(writes[0]!.split('/appointments/appt-1 ')[1]!)
    expect(body).toEqual({
      startTime: '2026-10-06T17:00:00.000Z',
      endTime: '2026-10-06T18:00:00.000Z',
      toNotify: true,
      ignoreDateRange: true,
      ignoreFreeSlotValidation: true,
    })
    expect(fake.ghl.appts.get('appt-1')).toMatchObject({ appointmentStatus: 'showed', assignedUserId: 'ghl-sales' })
  })

  test('fills in a missing assignee without notifying', async () => {
    linked({}, { assignedUserId: undefined })
    await syncEvent()
    const writes = fake.ghlWrites().filter((line) => line.includes('/appointments'))
    expect(writes).toEqual(['GHL PUT /calendars/events/appointments/appt-1 {"assignedUserId":"ghl-closer"}'])
  })
})

describe('Opportunity Webhook', () => {
  const mappings = { stageMappings: { Sat: 'Sat In GHL' } }

  beforeEach(() => {
    fake.addAccount({ accountId: 'Account.1', workflowStageName: 'Appointment Set', externalLeadId: 'c-1' })
  })

  test('writes the mapped Terros stage', async () => {
    await hookOpportunity('Sat In GHL', { ...config, ...mappings })
    expect(fake.terros.accounts.get('Account.1')!.workflowStageName).toBe('Sat')
    expect(warn).not.toHaveBeenCalled()
  })

  test('writes the stage before importing notes and survives a notes failure', async () => {
    fake.ghl.failNext.set('GET /contacts/c-1/notes', 500)
    await expect(hookOpportunity('Sat In GHL', { ...config, ...mappings })).resolves.toBeUndefined()
    expect(fake.terros.accounts.get('Account.1')!.workflowStageName).toBe('Sat')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('importing notes failed'))
  })

  test('imports GoHighLevel notes after the stage write', async () => {
    fake.ghl.notes.set('c-1', [
      { id: 'n-1', contactId: 'c-1', body: 'Called the homeowner', dateAdded: '2026-10-01T00:00:00.000Z' },
    ])
    await hookOpportunity('Sat In GHL', { ...config, ...mappings })
    const writes = fake.terrosWrites()
    expect(writes[0]).toContain('"workflowTarget":"Sat"')
    expect(writes.slice(1).join('\n')).toContain('Called the homeowner')
  })

  test('warns when no stageMappings entry matches and falls back to the raw stage name', async () => {
    await hookOpportunity('Sat')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No stageMappings entry matched pipeline stage Sat'))
    expect(fake.terros.accounts.get('Account.1')!.workflowStageName).toBe('Sat')
  })
  describe('skips that are not errors', () => {
    const hook = (payload: Record<string, unknown>) => opportunityWebhook(makeInput(payload, config))
    const skipped = () => expect(fake.terrosWrites()).toEqual([])

    test('a contact with no linked Terros account logs one line and writes nothing', async () => {
      const log = vi.mocked(console.log)
      log.mockClear()
      await expect(
        hook({ location: { id: LOCATION_ID }, contact_id: 'unknown-contact', customData: { pipeline_stage: 'Sat' } })
      ).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith(
        `GoHighLevel contact unknown-contact at location ${LOCATION_ID}: no Terros account is linked to this contact, skipping`
      )
      expect(fake.ghlWrites()).toEqual([])
      skipped()
      expect(error).not.toHaveBeenCalled()
    })

    test.each(['', undefined])('a blank pipeline_stage (%j) logs one line and writes nothing', async (stage) => {
      const log = vi.mocked(console.log)
      log.mockClear()
      await expect(
        hook({ location: { id: LOCATION_ID }, contact_id: 'c-1', customData: { pipeline_stage: stage } })
      ).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith(
        `GoHighLevel workflow webhook for contact c-1 at location ${LOCATION_ID} has no pipeline_stage, skipping`
      )
      expect(fake.ghlWrites()).toEqual([])
      skipped()
      expect(fake.terros.accounts.get('Account.1')!.workflowStageName).toBe('Appointment Set')
    })

    test('a location other than the configured one still throws', async () => {
      await expect(
        hook({ location: { id: 'other-location' }, contact_id: 'c-1', customData: { pipeline_stage: 'Sat' } })
      ).rejects.toThrow('does not match configured location')
      skipped()
    })

    test('a blank stage from another location still throws', async () => {
      await expect(
        hook({ location: { id: 'other-location' }, contact_id: 'c-1', customData: { pipeline_stage: '' } })
      ).rejects.toThrow('does not match configured location')
    })

    test('a missing contact_id or location id still throws', async () => {
      await expect(hook({ location: { id: LOCATION_ID }, customData: { pipeline_stage: 'Sat' } })).rejects.toThrow(
        'missing contact_id'
      )
      await expect(hook({ contact_id: 'c-1', customData: { pipeline_stage: 'Sat' } })).rejects.toThrow(
        'missing location.id'
      )
    })
  })
})
