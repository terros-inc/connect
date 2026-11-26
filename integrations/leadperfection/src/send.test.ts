import { type AccountId, type AccountWebhookData, IntegrationError, PermanentError } from '@terros-inc/sdk'
import { fakeLeadPerfection, fakeTerros } from './fakeLeadPerfection.ts'
import { sendAccount, type SendConfig } from './send.ts'

const accountId = 'Account.example1' as AccountId
const config: SendConfig = { sendStageIds: 'S.leadSet, S.other', srs_id: '56', sender: 'Acme Remodeling' }
// 2026-12-01 19:30 UTC is 2:30 PM in New York.
const appointmentDate = Date.parse('2026-12-01T19:30:00Z')

function account(overrides: Partial<AccountWebhookData> = {}): AccountWebhookData {
  return {
    id: accountId,
    createdAt: '2026-11-18T15:00:00Z',
    updatedAt: '2026-11-18T15:00:00Z',
    workflowState: { workflowId: 'WF.example', stageId: 'S.leadSet', stageName: 'Lead (Set)' },
    resident: { firstName: 'Pat', lastName: 'Example', phone: '5555550100', email: 'user@example.test' },
    address: {
      line1: '1234 NORTH EXAMPLE BOULEVARD EAST, BUILDING 7',
      locality: 'SPRINGFIELD',
      countrySubd: 'nc',
      postal1: '27519-1234',
    } as AccountWebhookData['address'],
    owner: {
      userId: 'U.example',
      firstName: 'Sam',
      lastName: 'Setter',
      email: 'setter@example.test',
      clientUserId: '478',
      timeZone: 'America/New_York',
    },
    closer: { userId: 'U.example2', firstName: 'Cy', lastName: 'Closer', email: 'closer@example.test' },
    note: 'Gate code is on the door',
    ...overrides,
  }
}

async function send(data: AccountWebhookData, stored: object = {}, sendConfig = config) {
  const lp = fakeLeadPerfection()
  const terros = fakeTerros([{ accountId, appointmentDate, ...stored }])
  await sendAccount(data, sendConfig, lp.client, terros.terros)
  return { lp, ...terros }
}

const leadAdd = '/api/Leads/LeadAdd'
const claim = expect.stringMatching(/^pending:/)

describe('LeadPerfection Send', () => {
  // Field-by-field mapping from the old integration, within the docs' LeadAdd limits.
  it('sends one LeadAdd with the mapped fields and saves the lead ID', async () => {
    const { lp, writes } = await send(account())

    expect(lp.added).toEqual([
      {
        firstname: 'Pat',
        lastname: 'Example',
        address1: '1234 North Example Boulevard East, Build',
        city: 'Springfield',
        state: 'NC',
        zip: '27519',
        phone: '5555550100',
        email: 'user@example.test',
        user1: 'setter@example.test',
        user2: 'closer@example.test',
        notes: 'Gate code is on the door',
        lognumber: accountId,
        pro_id: '478',
        sender: 'Acme Remodeling',
        srs_id: '56',
        apptdate: '12/01/2026',
        appttime: '02:30PM',
      },
    ])
    expect(writes).toEqual([
      {
        route: 'account/update',
        input: { account: { accountId, externalLeadId: claim }, onlyIfNoExternalLeadId: true },
      },
      { route: 'account/update', input: { account: { accountId, externalLeadId: '2901' } } },
    ])
  })

  it('sends a Canadian postal code whole, the configured product and market, and no non-numeric pro_id', async () => {
    const data = account({
      address: {
        line1: '1 Example St',
        locality: 'Toronto',
        countrySubd: 'ON',
        postal1: 'm5v 2t6',
      } as AccountWebhookData['address'],
      owner: { ...account().owner!, clientUserId: 'rep-7' },
    })

    const { lp } = await send(data, {}, { ...config, productID: 'Windows', brn_id: 'North' })

    expect(lp.added[0]).toMatchObject({ zip: 'M5V 2T6', productID: 'Windows', brn_id: 'North' })
    expect(lp.added[0]).not.toHaveProperty('pro_id')
  })

  // apptdate and appttime are both sent or both left out; a guessed zone would book the wrong local time.
  it('sends the appointment in the configured zone, or none without a zone', async () => {
    const chicago = await send(account(), {}, { ...config, timeZone: 'America/Chicago' })
    expect(chicago.lp.added[0]).toMatchObject({ apptdate: '12/01/2026', appttime: '01:30PM' })

    const noZone = await send(account({ owner: { ...account().owner!, timeZone: undefined } }))
    expect(noZone.lp.added[0]).not.toHaveProperty('apptdate')
    expect(noZone.lp.added[0]).not.toHaveProperty('appttime')
  })

  it.each([
    ['a stage that does not send', account({ workflowState: { workflowId: 'WF.example', stageId: 'S.sit' } }), {}],
    ['an account the webhook shows as sent', account({ externalLeadId: '2001' }), {}],
    ['an account another delivery already linked', account(), { externalLeadId: '2001' }],
    ['an account that came from LeadPerfection', account(), { accountSource: 'LeadPerfection' }],
    ['a resident without a last name', account({ resident: { firstName: 'Pat' } }), {}],
  ])('never sends %s', async (_, data, stored) => {
    const { lp, writes } = await send(data, stored)

    expect(lp.added).toEqual([])
    expect(writes).toEqual([])
  })

  // Two deliveries for one account, such as a stage change and an edit a second apart, both read no externalLeadId.
  // Without a claim only one of them can win, both called LeadAdd and LeadPerfection held two leads.
  it('adds one lead when two deliveries for an account overlap', async () => {
    const lp = fakeLeadPerfection()
    const { terros, store } = fakeTerros([{ accountId, appointmentDate }])

    await Promise.all([
      sendAccount(account(), config, lp.client, terros),
      sendAccount(account(), config, lp.client, terros),
    ])

    expect(lp.added).toHaveLength(1)
    expect(store.get(accountId)?.externalLeadId).toBe('2901')
  })

  it('does not call LeadAdd when another delivery claimed the account after it was read', async () => {
    const lp = fakeLeadPerfection()
    const { terros, store } = fakeTerros([
      { accountId, appointmentDate, externalLeadId: 'pending:2026-11-18T15:00:00.000Z' },
    ])
    const { account: accounts } = terros as { account: { get: (input: object) => Promise<object> } }
    let reads = 0
    const stale = {
      ...accounts,
      get: async (input: object) =>
        reads++ ? accounts.get(input) : { type: 'success', account: { accountId, appointmentDate } },
    }

    await sendAccount(account(), config, lp.client, { account: stale } as never)

    expect(lp.added).toEqual([])
    expect(store.get(accountId)?.externalLeadId).toBe('pending:2026-11-18T15:00:00.000Z')
  })

  // The claim was saved but its response was lost. Failing then left a claim no delivery owned, so every
  // redelivery skipped the account and it was never sent.
  it('sends the account when its claim was saved but the response was lost', async () => {
    const lp = fakeLeadPerfection()
    const { terros, store } = fakeTerros([{ accountId, appointmentDate }])
    const { account: accounts } = terros as { account: { update: (input: object) => Promise<object> } }
    let lost = false
    const lossy = {
      ...accounts,
      update: async (input: object) => {
        const saved = await accounts.update(input)
        if (lost) return saved
        lost = true
        throw new TypeError('fetch failed')
      },
    }

    await sendAccount(account(), config, lp.client, { account: lossy } as never)

    expect(lp.added).toHaveLength(1)
    expect(store.get(accountId)?.externalLeadId).toBe('2901')
  })

  // LeadPerfection can accept a lead and still time out, drop the connection or return a 5xx. Retrying that as a
  // transient failure added the lead a second time.
  it.each([
    ['a timeout', { throws: new DOMException('The operation was aborted due to timeout', 'TimeoutError') }],
    ['a network error', { throws: new TypeError('fetch failed') }],
    ['a 5xx', { status: 503, body: { Message: 'Service Unavailable' } }],
    ['a reply without the lead', { status: 200, body: [] }],
  ])('keeps the claim and stops for a person after %s on LeadAdd', async (_, failure) => {
    const lp = fakeLeadPerfection({ fail: { [leadAdd]: [failure] } })
    const { terros, store } = fakeTerros([{ accountId, appointmentDate }])

    const error = await sendAccount(account(), config, lp.client, terros).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PermanentError)
    expect((error as Error).message).toContain(`lognumber ${accountId}`)
    expect(store.get(accountId)?.externalLeadId).toEqual(claim)

    await sendAccount(account(), config, lp.client, terros)
    expect(lp.paths().filter((path) => path === leadAdd)).toHaveLength(1)
  })

  // Connect sends this app's own account updates back to Send like any other change. Clearing the claim after a
  // refusal was such an update, so a refusal that kept happening called LeadAdd again on every echo without end.
  it.each([
    ['refuses', [{ status: 200, body: [{ id: 0, Status: 0, Message: 'Invalid srs_id' }] }], IntegrationError, 1],
    ['rate-limits', Array(3).fill({ status: 429, body: { Message: 'Too many requests' } }), PermanentError, 3],
  ])('marks the account failed, once, when LeadPerfection %s the lead', async (_, failures, errorType, calls) => {
    vi.useFakeTimers()
    const lp = fakeLeadPerfection({ fail: { [leadAdd]: failures } })
    const { terros, store } = fakeTerros([{ accountId, appointmentDate }])
    const { account: accounts } = terros as { account: { update: (input: object) => Promise<object> } }
    const deliveries = [account()]
    const echoing = {
      ...accounts,
      update: async (input: object) => {
        const saved = await accounts.update(input)
        deliveries.push(account({ externalLeadId: store.get(accountId)?.externalLeadId }))
        return saved
      },
    }
    const errors: unknown[] = []

    for (let delivery = 0; delivery < 10 && deliveries.length; delivery++) {
      const sent = sendAccount(deliveries.shift()!, config, lp.client, { account: echoing } as never)
      await Promise.all([sent.catch((error: unknown) => errors.push(error)), vi.runAllTimersAsync()])
    }
    vi.useRealTimers()

    expect(deliveries).toEqual([])
    expect(lp.paths().filter((path) => path === leadAdd)).toHaveLength(calls)
    expect(errors).toEqual([expect.any(errorType)])
    expect(store.get(accountId)?.externalLeadId).toMatch(/^failed:/)

    // A person fixed the cause and cleared the marker.
    await accounts.update({ account: { accountId, externalLeadId: null } })
    await sendAccount(account(), config, lp.client, terros)
    expect(lp.added).toHaveLength(1)
  })

  // A 429 added nothing, and a redelivery would see this delivery's claim and skip the account.
  it('sends the account when a rate limit on LeadAdd clears within the run', async () => {
    vi.useFakeTimers()
    const lp = fakeLeadPerfection({ fail: { [leadAdd]: [{ status: 429, body: { Message: 'Too many requests' } }] } })
    const { terros, store } = fakeTerros([{ accountId, appointmentDate }])

    await Promise.all([sendAccount(account(), config, lp.client, terros), vi.runAllTimersAsync()])
    vi.useRealTimers()

    expect(lp.added).toHaveLength(1)
    expect(store.get(accountId)?.externalLeadId).toBe('2901')
  })

  // The claim's save conflicts whenever the attribute exists, while Send reads an empty one as unsent: such an
  // account was skipped as claimed by another delivery on every change, and never sent.
  it('stops for a person when an empty externalLeadId blocks the claim', async () => {
    const lp = fakeLeadPerfection()
    const { terros } = fakeTerros([{ accountId, appointmentDate, externalLeadId: '' }])

    const error = await sendAccount(account(), config, lp.client, terros).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PermanentError)
    expect((error as Error).message).toContain(`Account ${accountId}`)
    expect(lp.added).toEqual([])
  })
})
