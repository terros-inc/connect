import type { AccountWebhookData } from '@terros-inc/sdk'
import { toAccuLynxJob, toAccuLynxPhone } from './records.ts'
import { sendAccount } from './outgoing.ts'
import { fakeAccuLynx, fakeTerros } from './fakeAccuLynx.ts'

function account(overrides: Partial<AccountWebhookData> = {}): AccountWebhookData {
  return {
    id: 'Account.example',
    teamId: 'Team.north',
    homeowner: { firstName: 'Pat', lastName: 'Example', email: 'pat@example.test', phone: '+1 312 555 0100' },
    location: { line1: '1 Main St', locality: 'Springfield', countrySubd: 'IL', postal1: '62701' },
    ...overrides,
  } as AccountWebhookData
}

const created = {
  'POST /contacts/search': { body: { items: [] } },
  'POST /contacts': { status: 201, body: { id: 'contact-1' } },
  'POST /jobs': { status: 201, body: { id: 'job-1' } },
  'POST /jobs/external-references': { status: 201, body: {} },
}

describe('sendAccount', () => {
  // Prevents a job without its contact, an unlinked account (sent again on every change), or a job the
  // webhook cannot trace back to the account.
  test("recordType 'job' creates the contact, a job for it, links the account, and tags the job", async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()

    await sendAccount(account(), { recordType: 'job' }, client, terros)

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /contacts/search',
      'POST /contacts',
      'POST /jobs',
      'POST /jobs/external-references',
    ])
    expect(calls[0]!.body).toMatchObject({ searchTerm: 'Example', sort: { sortColumn: 'CreatedDate' } })
    expect(calls[1]!.body).toMatchObject({ firstName: 'Pat', crossReference: 'Account.example' })
    expect(calls[2]!.body).toMatchObject({ contact: { id: 'contact-1' } })
    expect(calls[3]!.body).toEqual({ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  test("recordType 'contact' links the contact and creates no job", async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()

    await sendAccount(account(), { recordType: 'contact' }, client, terros)

    expect(calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts'])
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'contact-1' } }])
  })

  // Prevents duplicate AccuLynx records on every account change, sends to the wrong location, and a silent
  // default direction when the install was not configured.
  test('sends nothing for a linked account, an account of another location, or a missing recordType', async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()

    await sendAccount(account({ externalLeadId: 'job-0' }), { recordType: 'job' }, client, terros)
    await sendAccount(
      account(),
      { recordType: 'job', accountFilterField: 'teamId', accountFilterValues: 'Team.south, Team.west' },
      client,
      terros
    )
    await expect(sendAccount(account(), {}, client, terros)).rejects.toThrow('recordType')

    expect(calls).toEqual([])
    expect(updates).toEqual([])
  })

  test('sends an account whose filter value is listed', async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros } = fakeTerros()

    await sendAccount(
      account(),
      { recordType: 'contact', accountFilterField: 'teamId', accountFilterValues: 'Team.south,Team.north' },
      client,
      terros
    )

    expect(calls).toHaveLength(2)
  })

  // Prevents linking the account to a job that does not exist.
  test('fails without linking when the job create fails', async () => {
    const { client } = fakeAccuLynx({ ...created, 'POST /jobs': { status: 400, body: { title: 'Bad request' } } })
    const { terros, updates } = fakeTerros()

    await expect(sendAccount(account(), { recordType: 'job' }, client, terros)).rejects.toThrow('400')
    expect(updates).toEqual([])
  })

  // Prevents a second contact and job when AccuLynx accepted both but saving the link in Terros failed.
  test('a retry after the Terros link failed reuses the contact, job and reference', async () => {
    const afterFirstAttempt = {
      ...created,
      'POST /contacts/search': {
        body: { items: [{ id: 'contact-1', crossReference: 'Account.example' }] },
      },
      'GET /contacts/contact-1/jobs': { body: { items: [{ id: 'job-1' }] } },
      'GET /jobs/external-references': { body: [{ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' }] },
    }
    const failing = fakeTerros('error')
    await expect(
      sendAccount(account(), { recordType: 'job' }, fakeAccuLynx(created).client, failing.terros)
    ).rejects.toThrow('Failed to save')

    const { client, calls } = fakeAccuLynx(afterFirstAttempt)
    const { terros, updates } = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, client, terros)

    expect(calls.filter((call) => call.method === 'POST' && call.path !== '/contacts/search')).toEqual([])
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  // Prevents an orphan contact per retry when the job create keeps failing, and reusing another account's
  // contact that only shares the name.
  test("a retry after the job create failed reuses this account's contact", async () => {
    const { client, calls } = fakeAccuLynx({
      ...created,
      'POST /contacts/search': {
        body: {
          items: [
            { id: 'contact-0', crossReference: 'Account.other' },
            { id: 'contact-1', crossReference: 'Account.example' },
          ],
        },
      },
      'GET /contacts/contact-1/jobs': { body: { items: [] } },
    })
    const { terros, updates } = fakeTerros()

    await sendAccount(account(), { recordType: 'job' }, client, terros)

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /contacts/search',
      'GET /contacts/contact-1/jobs',
      'POST /jobs',
      'POST /jobs/external-references',
    ])
    expect(calls[2]!.body).toMatchObject({ contact: { id: 'contact-1' } })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  // Prevents a linked account whose job the webhook can never map back, because the reference failed once and
  // linked accounts are not sent again.
  test('a failed job reference fails the delivery unlinked, and the retry adds it', async () => {
    const first = fakeAccuLynx({ ...created, 'POST /jobs/external-references': { status: 500 } })
    const firstTerros = fakeTerros()
    await expect(sendAccount(account(), { recordType: 'job' }, first.client, firstTerros.terros)).rejects.toThrow('500')
    expect(firstTerros.updates).toEqual([])

    const { client, calls } = fakeAccuLynx({
      ...created,
      'POST /contacts/search': { body: { items: [{ id: 'contact-1', crossReference: 'Account.example' }] } },
      'GET /contacts/contact-1/jobs': { body: { items: [{ id: 'job-1' }] } },
      'GET /jobs/external-references': { body: [] },
    })
    const { terros, updates } = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, client, terros)

    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/contacts/search',
      '/jobs/external-references',
    ])
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })
})

describe('AccuLynx record mapping', () => {
  // Prevents AccuLynx rejecting the contact: it accepts exactly 10 phone digits.
  test('phone numbers become 10 digits or are dropped', () => {
    expect(toAccuLynxPhone('+1 (312) 555-0100')).toBe('3125550100')
    expect(toAccuLynxPhone('312.555.0100')).toBe('3125550100')
    expect(toAccuLynxPhone('+44 20 555 0100')).toBeUndefined()
    expect(toAccuLynxPhone(undefined)).toBeUndefined()
  })

  // Prevents a non-US account's job being filed under the wrong country: AccuLynx needs a country with the
  // address, Terros has none, so it comes from the install or the address is left out.
  test('a job gets an address only when it is complete and the install names its country', () => {
    expect(toAccuLynxJob(account(), 'contact-1', { addressCountry: 'ca' }).locationAddress).toEqual({
      street1: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      country: 'CA',
      zipCode: '62701',
    })
    expect(toAccuLynxJob(account(), 'contact-1', {}).locationAddress).toBeUndefined()
    const noZip = account({ location: { line1: '1 Main St', locality: 'Springfield', countrySubd: 'IL' } as never })
    expect(toAccuLynxJob(noZip, 'contact-1', { addressCountry: 'US' }).locationAddress).toBeUndefined()
  })

  // Prevents creating a contact and then failing on the job because of a mistyped country.
  test('a bad addressCountry is refused before anything is created', async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros } = fakeTerros()

    await expect(
      sendAccount(account(), { recordType: 'job', addressCountry: 'Canada' }, client, terros)
    ).rejects.toThrow('addressCountry')
    expect(calls).toEqual([])
  })
})
