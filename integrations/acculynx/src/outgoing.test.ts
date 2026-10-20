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
      'POST /contacts',
      'POST /jobs',
      'POST /jobs/external-references',
    ])
    expect(calls[0]!.body).toMatchObject({ firstName: 'Pat', crossReference: 'Account.example' })
    expect(calls[1]!.body).toMatchObject({ contact: { id: 'contact-1' } })
    expect(calls[2]!.body).toEqual({ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  test("recordType 'contact' links the contact and creates no job", async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()

    await sendAccount(account(), { recordType: 'contact' }, client, terros)

    expect(calls.map((call) => call.path)).toEqual(['/contacts'])
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

    expect(calls).toHaveLength(1)
  })

  // Prevents linking the account to a job that does not exist.
  test('fails without linking when the job create fails', async () => {
    const { client } = fakeAccuLynx({ ...created, 'POST /jobs': { status: 400, body: { title: 'Bad request' } } })
    const { terros, updates } = fakeTerros()

    await expect(sendAccount(account(), { recordType: 'job' }, client, terros)).rejects.toThrow('400')
    expect(updates).toEqual([])
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

  // Prevents AccuLynx rejecting the job: a job address needs street, city, state and ZIP together.
  test('a job gets an address only when it is complete', () => {
    expect(toAccuLynxJob(account(), 'contact-1', {}).locationAddress).toEqual({
      street1: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      country: 'US',
      zipCode: '62701',
    })
    const noZip = account({ location: { line1: '1 Main St', locality: 'Springfield', countrySubd: 'IL' } as never })
    expect(toAccuLynxJob(noZip, 'contact-1', {}).locationAddress).toBeUndefined()
  })
})
