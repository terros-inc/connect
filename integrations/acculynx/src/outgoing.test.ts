import type { AccountWebhookData } from '@terros-inc/sdk'
import manifest from '../terros.json' with { type: 'json' }
import { isTestModeOn, matchesAccountFilter, toAccuLynxJob, toAccuLynxPhone } from './records.ts'
import { handler, sendAccount as sendAccountWithConfig } from './outgoing.ts'
import { contactTypes, fakeAccuLynx, fakeTerros } from './fakeAccuLynx.ts'

async function sendAccount(...args: Parameters<typeof sendAccountWithConfig>): Promise<void> {
  args[1] = { contactTypeId: 'type-configured', ...args[1] }
  return sendAccountWithConfig(...args)
}

function account(overrides: Partial<AccountWebhookData> = {}): AccountWebhookData {
  return {
    id: 'Account.example',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'New Lead' },
    resident: { firstName: 'Pat', lastName: 'Example', email: 'pat@example.test', phone: '+1 312 555 0100' },
    address: {
      line1: '1 Main St',
      locality: 'Springfield',
      countrySubd: 'IL',
      postal1: '62701',
      latlng: { latitude: 0, longitude: 0 },
    },
    ...overrides,
  }
}

function owner(
  overrides: Partial<NonNullable<AccountWebhookData['owner']>> = {}
): NonNullable<AccountWebhookData['owner']> {
  return {
    userId: 'U.example',
    firstName: 'Pat',
    lastName: 'Example',
    email: 'user@example.test',
    ...overrides,
  }
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
    const { client, calls, clock } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()
    await clock.sleep(Date.parse('2026-01-02T23:30:00Z'))

    await sendAccount(account(), { recordType: 'job', addressCountry: 'US' }, client, terros)

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /contacts/search',
      'POST /contacts',
      'POST /jobs',
      'POST /jobs/external-references',
      'GET /jobs/job-1',
    ])
    expect(calls[0]!.body).toMatchObject({
      searchTerm: 'Example',
      startDate: '2025-12-31',
      endDate: '2026-01-03',
      sort: { sortColumn: 'CreatedDate' },
    })
    expect(calls[1]!.body).toMatchObject({
      firstName: 'Pat',
      lastName: 'Example',
      crossReference: 'Account.example',
      contactTypeIds: ['type-configured'],
      phoneNumbers: [{ number: '3125550100', type: 'Home', primary: true }],
      emailAddresses: [{ address: 'pat@example.test', type: 'Personal', primary: true }],
      mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
    })
    expect(calls[2]!.body).toMatchObject({
      contact: { id: 'contact-1' },
      locationAddress: { street1: '1 Main St', city: 'Springfield', state: 'IL', country: 'US', zipCode: '62701' },
    })
    expect(calls[3]!.body).toEqual({ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  test("recordType 'contact' links the contact and creates no job", async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()

    await sendAccount(account(), { recordType: 'contact' }, client, terros)

    expect(calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts', '/contacts/contact-1'])
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'contact-1' } }])
  })

  test('configured contactTypeId is trimmed before contact creation', async () => {
    const { client, calls } = fakeAccuLynx(created)

    await sendAccountWithConfig(
      account(),
      { recordType: 'contact', contactTypeId: '  type-configured  ' },
      client,
      fakeTerros().terros
    )

    expect(calls.find((call) => call.path === '/contacts')?.body).toMatchObject({
      contactTypeIds: ['type-configured'],
    })
  })

  test.each([
    {
      name: 'one default',
      types: [
        { id: 'type-general', name: 'General Contact', isDefault: false },
        { id: 'type-customer', name: 'Customer', isDefault: true },
      ],
      expected: 'type-customer',
    },
    {
      name: 'Customer and another default',
      types: [
        { id: 'type-general', name: 'General Contact', isDefault: true },
        { id: 'type-customer', name: 'cUsToMeR', isDefault: true },
      ],
      expected: 'type-customer',
    },
    {
      name: 'several defaults without Customer',
      types: [
        { id: 'type-first', name: 'Primary', isDefault: true },
        { id: 'type-second', name: 'Secondary', isDefault: true },
      ],
      expected: 'type-first',
    },
  ])('blank contactTypeId uses $name', async ({ types, expected }) => {
    const { client, calls } = fakeAccuLynx({
      ...created,
      'GET /contacts/contact-types': contactTypes(...types),
    })

    await sendAccount(account(), { recordType: 'contact', contactTypeId: '' }, client, fakeTerros().terros)

    expect(calls.filter((call) => call.path === '/contacts/contact-types')).toHaveLength(1)
    expect(calls.find((call) => call.path === '/contacts')?.body).toMatchObject({ contactTypeIds: [expected] })
  })

  // Prevents a partial write when the install has no usable configured or default contact type.
  test.each([
    ['an empty list', contactTypes()],
    ['no marked default', contactTypes({ id: 'type-general', name: 'General Contact', isDefault: false })],
    ['a failed list call', { status: 500, body: { title: 'Unavailable' } }],
  ])('blank contactTypeId fails before creating anything for %s', async (_name, reply) => {
    const { client, calls } = fakeAccuLynx({ ...created, 'GET /contacts/contact-types': reply })

    await expect(
      sendAccount(account(), { recordType: 'job', contactTypeId: '' }, client, fakeTerros().terros)
    ).rejects.toThrow('contactTypeId')

    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  // Prevents silently selecting no type when the location's default is beyond the first API page.
  test('contact types after the first page are considered', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      id: `type-${index}`,
      name: `Type ${index}`,
      isDefault: false,
    }))
    const { client, calls } = fakeAccuLynx({
      ...created,
      'GET /contacts/contact-types?pageSize=25&pageStartIndex=0': contactTypes(...firstPage),
      'GET /contacts/contact-types?pageSize=25&pageStartIndex=1': contactTypes({
        id: 'type-later',
        name: 'Customer',
        isDefault: true,
      }),
    })

    await sendAccount(account(), { recordType: 'contact', contactTypeId: '' }, client, fakeTerros().terros)

    expect(calls.filter((call) => call.path === '/contacts/contact-types').map((call) => call.query)).toEqual([
      '?pageSize=25&pageStartIndex=0',
      '?pageSize=25&pageStartIndex=1',
    ])
    expect(calls.find((call) => call.path === '/contacts')?.body).toMatchObject({
      contactTypeIds: ['type-later'],
    })
  })

  // Prevents a failed delivery when a full page of other contacts is the last one: AccuLynx answers the next page
  // with 416.
  test('a 416 after a full page ends the contact search', async () => {
    const others = Array.from({ length: 25 }, (_, index) => ({
      id: `contact-${index}`,
      crossReference: 'Account.other',
    }))
    const { client, calls } = fakeAccuLynx({
      ...created,
      'POST /contacts/search': [{ body: { items: others } }, { status: 416 }],
    })
    const { terros, updates } = fakeTerros()

    await sendAccount(account(), { recordType: 'contact' }, client, terros)

    expect(calls.map((call) => call.path)).toEqual([
      '/contacts/search',
      '/contacts/search',
      '/contacts',
      '/contacts/contact-1',
    ])
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
      { recordType: 'job', accountFilterField: 'workflowState.workflowId', accountFilterValues: 'WF.south, WF.west' },
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
      {
        recordType: 'contact',
        accountFilterField: 'workflowState.workflowId',
        accountFilterValues: 'WF.south,WF.north',
      },
      client,
      terros
    )

    expect(calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts', '/contacts/contact-1'])
  })

  // Prevents an optional diagnostic endpoint from breaking a valid configured-ID install check, while ensuring the
  // check cannot create a customer-visible record or mark the Terros account as linked.
  test('test mode with a configured ID skips contact-type listing and logs exact payloads without any write', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { client, calls } = fakeAccuLynx(
      {
        'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } },
        'GET /contacts/contact-types': { status: 500, body: { title: 'Unavailable' } },
      },
      true
    )
    const { terros, updates } = fakeTerros()

    await sendAccount(
      account({ workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Sold' } }),
      { recordType: 'job', triggerStages: 'Sold', addressCountry: 'US', testMode: true },
      client,
      terros
    )

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /company-settings'])
    expect(updates).toEqual([])
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('connection check succeeded')
    expect(output).toContain('DRY RUN: account Account.example qualifies')
    expect(output).toContain('DRY RUN: contact payload')
    expect(output).toContain('Using configured AccuLynx contact type')
    expect(output).toContain('"contactTypeIds":["type-configured"]')
    expect(output).toContain('"crossReference":"Account.example"')
    expect(output).toContain('DRY RUN: job payload')
    expect(output).toContain('"id":"<created-contact-id>"')
    expect(output).toContain('AccuLynx GET /company-settings -> 200')
    log.mockRestore()
  })

  // Prevents an Account remove dry run from failing on contact-type discovery even though it cannot create a contact.
  test('test-mode remove checks only the API key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fake = fakeAccuLynx(
      {
        'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } },
        'GET /contacts/contact-types': { status: 500, body: { title: 'Unavailable' } },
      },
      true
    )
    vi.stubGlobal('fetch', fake.fetch)

    await handler({
      runId: 'ConnectRun.example',
      context: {
        payload: { entity: 'Account', action: 'remove', data: 'Account.example' },
        config: {
          scriptConfig: { testMode: 'true', contactTypeId: '' },
          secrets: { apiKey: 'key-example' },
        },
      },
    })

    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /company-settings'])
    expect(log.mock.calls.flat().join('\n')).toContain('Skipping AccuLynx send for Account remove')
    vi.unstubAllGlobals()
    log.mockRestore()
  })

  test.each([
    {
      types: [
        { id: 'type-general', name: 'General Contact', isDefault: true },
        { id: 'type-customer', name: 'Customer', isDefault: true },
      ],
      expected: 'type-customer',
      reason: 'default named Customer',
    },
    {
      types: [
        { id: 'type-primary', name: 'Primary', isDefault: true },
        { id: 'type-secondary', name: 'Secondary', isDefault: true },
      ],
      expected: 'type-primary',
      reason: 'first default',
    },
  ])('test mode reuses connection-check types and logs $reason', async ({ types, expected, reason }) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { client, calls } = fakeAccuLynx(
      {
        'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } },
        'GET /contacts/contact-types': contactTypes(...types),
      },
      true
    )

    await sendAccount(
      account(),
      { recordType: 'contact', contactTypeId: '', testMode: 'true' },
      client,
      fakeTerros().terros
    )

    expect(calls.filter((call) => call.path === '/contacts/contact-types')).toHaveLength(1)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain(reason)
    expect(output).toContain(`"contactTypeIds":["${expected}"]`)
    log.mockRestore()
  })

  // Prevents test mode from hiding why an account would not send, which would make rollout validation ambiguous.
  test('test mode logs every existing account skip reason and still makes no write', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const connection = {
      'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } },
      'GET /contacts/contact-types': contactTypes({ id: 'type-customer', name: 'Customer', isDefault: true }),
    }
    const fake = fakeAccuLynx(connection, true)
    const terros = fakeTerros()

    await sendAccount(
      account(),
      { recordType: 'contact', triggerStages: 'Sold', testMode: 'on' },
      fake.client,
      terros.terros
    )
    await sendAccount(
      account(),
      {
        recordType: 'contact',
        accountFilterField: 'workflowState.workflowId',
        accountFilterValues: 'WF.south',
        testMode: 'yes',
      },
      fake.client,
      terros.terros
    )
    await sendAccount(
      account({ externalLeadId: 'contact-existing' }),
      { recordType: 'contact', testMode: '1' },
      fake.client,
      terros.terros
    )

    expect(fake.calls.every((call) => call.method === 'GET')).toBe(true)
    expect(terros.updates).toEqual([])
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('current stage is not one of')
    expect(output).toContain('workflowState.workflowId is not one of')
    expect(output).toContain('already linked to AccuLynx record')
    log.mockRestore()
  })

  // Prevents a bad key from being mistaken for a successful dry run and ensures diagnostics cannot echo the key.
  test('a 401 connection check fails clearly and redacts the API key from every log', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fake = fakeAccuLynx(
      { 'GET /company-settings': { status: 401, body: { message: 'key-example is invalid' } } },
      true
    )

    await expect(
      sendAccount(account(), { recordType: 'contact', testMode: 'true' }, fake.client, fakeTerros().terros)
    ).rejects.toThrow('401')

    const output = [...log.mock.calls, ...error.mock.calls].flat().join('\n')
    expect(output).toContain('API key is missing, invalid, or deactivated (401)')
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('key-example')
    log.mockRestore()
    error.mockRestore()
  })

  // Prevents migrated and unsaved install values from changing the safety switch's behavior.
  test.each([
    { value: true, expected: true },
    { value: false, expected: false },
    { value: undefined, expected: false },
    { value: null, expected: false },
    { value: ' TRUE ', expected: true },
    { value: 'Yes', expected: true },
    { value: ' ON ', expected: true },
    { value: '1', expected: true },
    { value: ' FALSE ', expected: false },
    { value: 'No', expected: false },
    { value: ' OFF ', expected: false },
    { value: '0', expected: false },
  ])('reads testMode $value as $expected', ({ value, expected }) => {
    expect(isTestModeOn(value)).toBe(expected)
  })

  // Prevents a misspelled legacy safety switch from silently enabling live writes.
  test('an unknown testMode value is logged and treated as on', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(isTestModeOn('ture')).toBe(true)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('treating it as true'))
    error.mockRestore()
  })

  test('declares testMode as a boolean install field', () => {
    const send = manifest.scripts.find((script) => script.slug === 'acculynx-send')
    expect(send?.configSchema.find((field) => field.name === 'testMode')?.type).toBe('boolean')
  })

  // Prevents early-stage accounts from being irreversibly created in AccuLynx while preserving stage names that
  // differ only in case or accidental surrounding whitespace.
  test('sends only at a configured trigger stage, matched case-insensitively after trimming', async () => {
    const skipped = fakeAccuLynx(created)
    const skippedTerros = fakeTerros()
    await sendAccount(
      account(),
      { recordType: 'contact', triggerStages: ' Appointment Set, Sold ' },
      skipped.client,
      skippedTerros.terros
    )

    const sent = fakeAccuLynx(created)
    const sentTerros = fakeTerros()
    await sendAccount(
      account({ workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: '  SOLD  ' } }),
      { recordType: 'contact', triggerStages: 'Appointment Set, sold' },
      sent.client,
      sentTerros.terros
    )

    expect(skipped.calls).toEqual([])
    expect(skippedTerros.updates).toEqual([])
    expect(sent.calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts', '/contacts/contact-1'])
  })

  // Prevents an account belonging to several teams from being skipped or routed to the wrong location, and proves
  // the independent stage and market restrictions both apply.
  test.each([
    {
      field: 'owner.memberOf',
      values: 'Market A',
      owner: {
        userId: 'U.example' as const,
        firstName: 'Pat',
        lastName: 'Example',
        email: 'user@example.test',
        memberOf: [
          { teamId: 'Team.other' as const, name: 'Market B' },
          { teamId: 'Team.market' as const, name: 'Market A' },
        ],
      },
    },
    {
      field: 'owner.teamIds',
      values: 'Team.market',
      owner: {
        userId: 'U.example' as const,
        firstName: 'Pat',
        lastName: 'Example',
        email: 'user@example.test',
        teamIds: ['Team.other' as const, 'Team.market' as const],
      },
    },
  ])('matches any value in $field while also requiring the trigger stage', async ({ field, values, owner }) => {
    const matching = fakeAccuLynx(created)
    await sendAccount(
      account({ owner, workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Sold' } }),
      { recordType: 'contact', triggerStages: 'Sold', accountFilterField: field, accountFilterValues: values },
      matching.client,
      fakeTerros().terros
    )

    const wrongStage = fakeAccuLynx(created)
    await sendAccount(
      account({ owner }),
      { recordType: 'contact', triggerStages: 'Sold', accountFilterField: field, accountFilterValues: values },
      wrongStage.client,
      fakeTerros().terros
    )

    const wrongMarket = fakeAccuLynx(created)
    await sendAccount(
      account({ owner, workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Sold' } }),
      { recordType: 'contact', triggerStages: 'Sold', accountFilterField: field, accountFilterValues: 'Team.none' },
      wrongMarket.client,
      fakeTerros().terros
    )

    expect(matching.calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts', '/contacts/contact-1'])
    expect(wrongStage.calls).toEqual([])
    expect(wrongMarket.calls).toEqual([])
  })

  // Prevents one account from qualifying for two location installs when its owner belongs to both markets, while
  // preserving owner-team routing for accounts that have not been assigned a team.
  test.each([
    {
      name: 'assigned account team matches',
      account: account({
        teamId: 'Team.market',
        owner: owner({ teamIds: ['Team.other'] }),
      }),
      field: 'owner.teamIds',
      values: 'Team.market',
      expected: true,
    },
    {
      name: 'assigned account team rejects without owner fallback',
      account: account({
        teamId: 'Team.other',
        owner: owner({ teamIds: ['Team.market'] }),
      }),
      field: 'owner.teamIds',
      values: 'Team.market',
      expected: false,
    },
    {
      name: 'missing account team falls back to a matching owner team',
      account: account({
        owner: owner({ teamIds: ['Team.market'] }),
      }),
      field: 'owner.teamIds',
      values: 'Team.market',
      expected: true,
    },
    {
      name: 'missing account team rejects a nonmatching owner team',
      account: account({
        owner: owner({ teamIds: ['Team.other'] }),
      }),
      field: 'owner.teamIds',
      values: 'Team.market',
      expected: false,
    },
    {
      name: 'unassigned account team falls back to the owner',
      account: account({
        teamId: 'Team.unassigned',
        owner: owner({ teamIds: ['Team.market'] }),
      }),
      field: 'owner.teamIds',
      values: 'Team.market',
      expected: true,
    },
    {
      name: 'unassigned sentinel is not a matchable account team',
      account: account({ teamId: 'Team.unassigned' }),
      field: 'teamId',
      values: 'Team.unassigned',
      expected: false,
    },
    {
      name: 'non-team filter remains unchanged',
      account: account({ teamId: 'Team.other' }),
      field: 'workflowState.workflowId',
      values: 'WF.north',
      expected: true,
    },
  ])('$name', ({ account: input, field, values, expected }) => {
    expect(matchesAccountFilter(input, { accountFilterField: field, accountFilterValues: values })).toBe(expected)
  })

  test('test mode logs whether account-team or owner-team routing matched', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    matchesAccountFilter(
      account({ teamId: 'Team.other' }),
      {
        accountFilterField: 'owner.teamIds',
        accountFilterValues: 'Team.market',
      },
      true
    )
    matchesAccountFilter(
      account({
        owner: owner({ memberOf: [{ teamId: 'Team.market', name: 'Market A' }] }),
      }),
      { accountFilterField: 'owner.memberOf', accountFilterValues: 'Market A' },
      true
    )

    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('used account team; team=["Team.other"]; rejected')
    expect(output).toContain('used owner teams from owner.memberOf; team=["Team.market","Market A"]; matched')
    log.mockRestore()
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
      'GET /jobs/job-1',
    ])
    expect(calls[2]!.body).toMatchObject({ contact: { id: 'contact-1' } })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  // Prevents a retry linking (and tagging) a job someone else added to the contact in AccuLynx instead of the job
  // created for this account.
  test("a retry reuses only the job proven to be this account's when the contact has several", async () => {
    const recovered = {
      ...created,
      'POST /contacts/search': { body: { items: [{ id: 'contact-1', crossReference: 'Account.example' }] } },
      'GET /contacts/contact-1/jobs': { body: { items: [{ id: 'job-0' }, { id: 'job-1' }, { id: 'job-2' }] } },
      'GET /jobs/external-references?jobId=job-0&source=Terros': { status: 404 },
      'GET /jobs/external-references?jobId=job-2&source=Terros': { status: 404 },
    }

    const tagged = fakeAccuLynx({
      ...recovered,
      'GET /jobs/external-references?jobId=job-1&source=Terros': {
        body: [{ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' }],
      },
    })
    const taggedTerros = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, tagged.client, taggedTerros.terros)
    expect(tagged.calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['/contacts/search'])
    expect(taggedTerros.updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])

    // No job names this account and several have no reference, so none is provably its own: create one.
    const untagged = fakeAccuLynx({
      ...recovered,
      'GET /jobs/external-references?jobId=job-1&source=Terros': {
        body: [{ jobId: 'job-1', source: 'Terros', projectId: 'Account.other' }],
      },
      'POST /jobs': { status: 201, body: { id: 'job-3' } },
    })
    const untaggedTerros = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, untagged.client, untaggedTerros.terros)
    expect(untagged.calls.filter((call) => call.method === 'POST').map((call) => call.body)).toContainEqual({
      jobId: 'job-3',
      source: 'Terros',
      projectId: 'Account.example',
    })
    expect(untaggedTerros.updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-3' } }])
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
      'GET /jobs/external-references': { status: 404 },
    })
    const { terros, updates } = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, client, terros)

    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/contacts/search',
      '/jobs/external-references',
    ])
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'job-1' } }])
  })

  // Prevents a diagnostic read-back from blocking the durable Terros link, including AccuLynx's known unassigned-job gap.
  test('job read-back confirms a readable create and tolerates an unassigned job', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const readable = fakeAccuLynx({
      ...created,
      'POST /jobs': { status: 201, body: { id: 'job-1', _link: '/jobs/job-1' } },
      'GET /jobs/job-1': { body: { id: 'job-1' } },
    })
    const readableTerros = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, readable.client, readableTerros.terros)

    const unassigned = fakeAccuLynx(created)
    const unassignedTerros = fakeTerros()
    await sendAccount(account(), { recordType: 'job' }, unassigned.client, unassignedTerros.terros)

    expect(readableTerros.updates).toHaveLength(1)
    expect(unassignedTerros.updates).toHaveLength(1)
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('link=/jobs/job-1')
    expect(output).toContain('Confirmed AccuLynx job job-1 is readable after create')
    expect(output).toContain('created but is not yet readable (likely unassigned)')
    log.mockRestore()
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

  // Prevents a location's configured fallback from filing a webhook address under the wrong country.
  test('a job prefers the webhook country, falls back to config, and requires a complete address', () => {
    const webhookCountry = account({ address: { ...account().address!, country: 'US' } })
    expect(toAccuLynxJob(webhookCountry, 'contact-1', {}).locationAddress).toMatchObject({ country: 'US' })
    expect(toAccuLynxJob(webhookCountry, 'contact-1', { addressCountry: 'CA' }).locationAddress).toMatchObject({
      country: 'US',
    })
    const invalidWebhookCountry = account({
      address: { ...account().address!, country: 'USA' as 'US' },
    })
    expect(toAccuLynxJob(invalidWebhookCountry, 'contact-1', { addressCountry: 'ca' }).locationAddress).toMatchObject({
      country: 'CA',
    })
    expect(toAccuLynxJob(account(), 'contact-1', { addressCountry: 'ca' }).locationAddress).toEqual({
      street1: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      country: 'CA',
      zipCode: '62701',
    })
    expect(toAccuLynxJob(account(), 'contact-1', {}).locationAddress).toBeUndefined()
    const noZip = account({
      address: {
        line1: '1 Main St',
        locality: 'Springfield',
        countrySubd: 'IL',
        postal1: '',
        latlng: { latitude: 0, longitude: 0 },
      },
    })
    expect(toAccuLynxJob(noZip, 'contact-1', { addressCountry: 'US' }).locationAddress).toBeUndefined()
  })

  // Prevents creating a contact and then failing on the job because of a mistyped country.
  test('a bad addressCountry is refused before anything is created, even with a webhook country', async () => {
    const { client, calls } = fakeAccuLynx(created)
    const { terros } = fakeTerros()
    const webhookCountry = account({ address: { ...account().address!, country: 'US' } })

    await expect(
      sendAccount(webhookCountry, { recordType: 'job', addressCountry: 'Canada' }, client, terros)
    ).rejects.toThrow('addressCountry')
    expect(calls).toEqual([])
  })
})
