import type { AccountId } from '@terros-inc/sdk'
import { findTarget, LIMITS, syncResults, type SyncConfig } from './sync.ts'
import { getLeadLeadRow, jobStatusChangeRow, salesAppointmentRow } from './fixtures.ts'
import { fakeLeadPerfection, fakeTerros } from './fakeLeadPerfection.ts'

const now = Date.parse('2026-11-18T15:00:00Z')
const config: SyncConfig = {
  workflowId: 'WF.example',
  resultStages: {
    Set: 'S.leadSet',
    Sale: 'S.customer',
    DNS: 'S.demoNoSale',
    'DNS-U': 'S.demoNoSale',
    CXL: 'S.resched',
  },
  jobStatusStages: { Complete: 'S.jobDone' },
  timeZone: 'America/New_York',
}

const appointment = (cstId: number, Disposition: string, extra: object = {}) => ({
  ...salesAppointmentRow,
  ID: 5000 + cstId,
  IlsID: 5000 + cstId,
  Cst_ID: cstId,
  Disposition,
  Phone: '',
  ...extra,
})
const job = (cstId: string, jobstatus: string, extra: object = {}) => ({
  ...jobStatusChangeRow,
  cst_id: cstId,
  jobstatus,
  phone1: '',
  ...extra,
})
const lead = (lognumber: string, in1_id: string) => ({ ...getLeadLeadRow, lognumber, in1_id })

const inStage = (stageId: string) => ({ workflowId: 'WF.example' as never, workflowStageId: stageId as never })

function scenario(requestType?: string) {
  const lp = fakeLeadPerfection({
    appointments: [
      appointment(1001, 'Sale'),
      appointment(1002, 'DNS'),
      appointment(1003, 'CXL', { Phone: '(555)555-0103', zip: '27519' }),
      appointment(1005, 'Sale'),
      appointment(1006, 'CCC'),
    ],
    jobs: [job('1001', 'Complete'), job('1004', 'Complete')],
    leads: {
      '1001': [lead('Account.exampleSent', '2901')],
      '1002': [lead('', '2902')],
      '1003': [lead('', '')],
      '1005': [lead('', '')],
    },
  })
  const terros = fakeTerros([
    { accountId: 'Account.exampleSent', externalLeadId: '2901', ...inStage('S.leadSet') },
    { accountId: 'Account.exampleSent2', externalLeadId: '2902', ...inStage('S.leadSet') },
    {
      accountId: 'Account.examplePhone',
      ...inStage('S.leadSet'),
      location: { postal1: '27519' } as never,
      resident: { phone: '555-555-0103' },
    },
    { accountId: 'Account.linked', sourceId: '1004', ...inStage('S.customer') },
  ])
  const run = () => syncResults({ ...config, requestType }, lp.client, terros.terros, now)
  const getLeadCalls = () => lp.calls.filter((call) => call.url.endsWith('/GetLead')).map((call) => call.form.cst_id)
  return { lp, ...terros, run, getLeadCalls }
}

const stageOf = (store: Map<AccountId, { workflowStageId?: string }>, accountId: string) =>
  store.get(accountId as AccountId)?.workflowStageId

describe('LeadPerfection Sync', () => {
  it('reads a look-back window with MM/DD/YYYY dates', async () => {
    const { lp, run } = scenario()
    await run()

    const forms = Object.fromEntries(lp.calls.map((call) => [new URL(call.url).pathname, call.form]))
    expect(forms['/api/SalesApi/GetSalesApptDetailDateRange']).toEqual({
      apptdates: '11/16/2026',
      apptdatee: '11/18/2026',
    })
    expect(forms['/api/Customers/GetJobStatusChanges']).toMatchObject({
      startdate: '11/16/2026',
      enddate: '11/19/2026',
    })
  })

  // Matches by the linked sourceId, then lognumber, then the saved inbound lead ID, then phone; maps results and
  // job statuses with the job status last; leaves unmapped and unmatched customers alone.
  it('moves matched accounts to their mapped stages and links them', async () => {
    const { store, run, getLeadCalls } = scenario()
    await run()

    expect(stageOf(store, 'Account.exampleSent')).toBe('S.jobDone')
    expect(stageOf(store, 'Account.exampleSent2')).toBe('S.demoNoSale')
    expect(stageOf(store, 'Account.examplePhone')).toBe('S.resched')
    expect(stageOf(store, 'Account.linked')).toBe('S.jobDone')
    expect(store.get('Account.exampleSent' as AccountId)).toMatchObject({
      sourceId: '1001',
      sourceStatus: 'Complete',
      lastActionDate: Date.parse('2026-11-12T05:00:00Z'), // the contract date, midnight in New York
    })
    expect(store.get('Account.exampleSent2' as AccountId)?.sourceId).toBe('1002')
    expect(store.size).toBe(4)
    // 1004 was linked already and 1006 has no mapped status, so neither costs a GetLead call.
    expect(getLeadCalls()).toEqual(['1001', '1002', '1003', '1005'])
  })

  // A re-run over the same window must neither write nor spend LeadPerfection calls on customers it linked.
  it('changes nothing when run again over the same window', async () => {
    const { writes, run, getLeadCalls } = scenario()
    await run()
    const firstWrites = writes.length
    const firstLookups = getLeadCalls().length

    await run()

    expect(writes).toHaveLength(firstWrites)
    expect(getLeadCalls().slice(firstLookups)).toEqual(['1005'])
  })

  it('creates an account for a customer that started in LeadPerfection only with requestType upsert', async () => {
    const { store, writes, run, getLeadCalls } = scenario('upsert')
    await run()

    expect(store.get('Account.exampleCreated1' as AccountId)).toMatchObject({
      workflowStageId: 'S.customer',
      sourceId: '1005',
      accountSource: 'LeadPerfection',
      resident: { firstName: 'Pat', lastName: 'Example' },
      location: { line1: '100 Example Way', locality: 'Springfield', countrySubd: 'NC', postal1: '27519' },
    })
    const firstWrites = writes.length
    const firstLookups = getLeadCalls().length

    await run()

    expect(writes).toHaveLength(firstWrites)
    expect(getLeadCalls()).toHaveLength(firstLookups)
  })

  // Unmatched customers are looked up on every run; without rotation the first ones would use every run's lookups.
  it('looks up every customer over successive runs when one run cannot look up them all', async () => {
    const cstIds = [1, 2, 3, 4, 5, 6]
    const lp = fakeLeadPerfection({ appointments: cstIds.map((cstId) => appointment(cstId, 'Sale')) })
    const { terros } = fakeTerros()
    const lookups = LIMITS.leadLookups
    LIMITS.leadLookups = 2
    try {
      for (const run of [0, 1, 2]) await syncResults(config, lp.client, terros, now + run * 600_000)
    } finally {
      LIMITS.leadLookups = lookups
    }

    const looked = lp.calls.filter((call) => call.url.endsWith('/GetLead')).map((call) => Number(call.form.cst_id))
    expect(looked).toHaveLength(6)
    expect(new Set(looked)).toEqual(new Set(cstIds))
  })

  it('prefers the lognumber over the inbound lead ID when they name different accounts', async () => {
    const lp = fakeLeadPerfection({
      appointments: [appointment(1001, 'Sale')],
      leads: { '1001': [lead('', '2902'), lead('Account.exampleSent', '')] },
    })
    const { store, terros } = fakeTerros([
      { accountId: 'Account.exampleSent', externalLeadId: '2901', ...inStage('S.leadSet') },
      { accountId: 'Account.exampleSent2', externalLeadId: '2902', ...inStage('S.leadSet') },
    ])

    await syncResults(config, lp.client, terros, now)

    expect(stageOf(store, 'Account.exampleSent')).toBe('S.customer')
    expect(stageOf(store, 'Account.exampleSent2')).toBe('S.leadSet')
  })

  it('matches no account when two share the phone number', async () => {
    const lp = fakeLeadPerfection({
      appointments: [appointment(1003, 'CXL', { Phone: '(555)555-0103', zip: '27519' })],
      leads: { '1003': [lead('', '')] },
    })
    const sharedPhone = { location: { postal1: '27519' } as never, resident: { phone: '5555550103' } }
    const { writes, terros } = fakeTerros([
      { accountId: 'Account.a', ...sharedPhone },
      { accountId: 'Account.b', ...sharedPhone },
    ])

    await syncResults(config, lp.client, terros, now)

    expect(writes).toEqual([])
  })
})

describe('findTarget', () => {
  it('dates Set by the entry date and other results by the appointment date', () => {
    const dates = { entryDate: '2026-11-10T00:00:00', apptDate: '2026-11-12T14:00:00' }
    expect(findTarget({ cstId: '1', result: 'Set', ...dates }, config)).toEqual({
      stageId: 'S.leadSet',
      sourceStatus: 'Set',
      date: dates.entryDate,
    })
    expect(findTarget({ cstId: '1', result: 'dns-u ', ...dates }, config)?.date).toBe(dates.apptDate)
    expect(findTarget({ cstId: '1', result: 'CCC', jobStatus: 'ReleToProd', ...dates }, config)).toBeUndefined()
  })
})
