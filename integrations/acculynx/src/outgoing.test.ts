import type { AccountWebhookData } from '@terros-inc/sdk'
import { isSyncUpdatesOn, isTestModeOn, matchesAccountFilter, toAccuLynxJob, toAccuLynxPhone } from './records.ts'
import { sendAccount, toSyncState } from './outgoing.ts'
import { fakeAccuLynx, fakeTerros } from './fakeAccuLynx.ts'

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

function savedState(
  sentNoteIds: string[] = [],
  extra: { job?: boolean; leadSourceId?: string; country?: string } = {}
): string {
  const input = account(
    extra.job ? { address: { ...account().address!, country: (extra.country ?? 'US') as 'US' | 'CA' | 'PR' } } : {}
  )
  return JSON.stringify(
    toSyncState(
      input,
      { recordType: extra.job ? 'job' : 'contact', leadSourceId: extra.leadSourceId },
      extra.job ? 'job' : 'contact',
      sentNoteIds
    )
  )
}

function fakeLinkedTerros(state: string) {
  return fakeTerros('success', { 'CF.syncstate': state })
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

  // Prevents a note that existed at first send from being appended again when update sync handles the link event.
  test('an update-enabled create saves its field fingerprint and initial note IDs with the link', async () => {
    const { client } = fakeAccuLynx(created)
    const { terros, updates } = fakeTerros()
    await sendAccount(
      account({
        notes: [{ noteId: 'Note.example', text: 'Initial note', timestamp: 1, userId: 'U.example' }],
      }),
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      client,
      terros
    )

    const saved = updates[0] as { account: { externalLeadId: string; customFieldsPatch: Record<string, string> } }
    expect(saved.account.externalLeadId).toBe('contact-1')
    expect(JSON.parse(saved.account.customFieldsPatch['CF.syncstate']!)).toMatchObject({
      version: 1,
      fingerprint: expect.any(String),
      sentNoteIds: ['Note.example'],
    })
  })

  // Prevents a bad update-sync configuration from creating an unlinked vendor record on every retry.
  test('update sync validates its state field before any AccuLynx request', async () => {
    const fake = fakeAccuLynx(created)

    await expect(
      sendAccount(account(), { recordType: 'contact', syncUpdates: 'true' }, fake.client, fakeTerros().terros)
    ).rejects.toThrow('syncStateFieldId')
    expect(fake.calls).toEqual([])
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

  // Prevents an install check from creating a customer-visible record or marking the Terros account as linked.
  test('test mode checks the connection and logs exact payloads without any write', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { client, calls } = fakeAccuLynx(
      {
        'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } },
      },
      true
    )
    const { terros, updates } = fakeTerros()

    await sendAccount(
      account({ workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Sold' } }),
      { recordType: 'job', triggerStages: 'Sold', addressCountry: 'US', testMode: 'true' },
      client,
      terros
    )

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /company-settings'])
    expect(updates).toEqual([])
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('connection check succeeded')
    expect(output).toContain('DRY RUN: account Account.example qualifies')
    expect(output).toContain('DRY RUN: contact payload')
    expect(output).toContain('"crossReference":"Account.example"')
    expect(output).toContain('DRY RUN: job payload')
    expect(output).toContain('"id":"<created-contact-id>"')
    expect(output).toContain('AccuLynx GET /company-settings -> 200')
    log.mockRestore()
  })

  // Prevents test mode from hiding why an account would not send, which would make rollout validation ambiguous.
  test('test mode logs every existing account skip reason and still makes no write', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const connection = { 'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } } }
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

    expect(fake.calls.every((call) => call.method === 'GET' && call.path === '/company-settings')).toBe(true)
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

  // Prevents a misspelled safety switch from silently enabling live writes.
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

  // Prevents early-stage accounts from being irreversibly created in AccuLynx while preserving name-valued settings
  // on existing installs.
  test('sends at a configured stage ID or legacy stage name', async () => {
    const skipped = fakeAccuLynx(created)
    const skippedTerros = fakeTerros()
    await sendAccount(
      account(),
      { recordType: 'contact', triggerStages: ' Appointment Set, Sold ' },
      skipped.client,
      skippedTerros.terros
    )

    const sentById = fakeAccuLynx(created)
    const sentByIdTerros = fakeTerros()
    await sendAccount(
      account({ workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Renamed' } }),
      { recordType: 'contact', triggerStages: 'S.example' },
      sentById.client,
      sentByIdTerros.terros
    )

    const sentByName = fakeAccuLynx(created)
    const sentByNameTerros = fakeTerros()
    await sendAccount(
      account({ workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: '  SOLD  ' } }),
      { recordType: 'contact', triggerStages: 'Appointment Set, sold' },
      sentByName.client,
      sentByNameTerros.terros
    )

    expect(skipped.calls).toEqual([])
    expect(skippedTerros.updates).toEqual([])
    expect(sentById.calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts', '/contacts/contact-1'])
    expect(sentByName.calls.map((call) => call.path)).toEqual(['/contacts/search', '/contacts', '/contacts/contact-1'])
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

  // Prevents a webhook-originated stage/closer update from echoing back to AccuLynx. The persisted snapshot lets
  // this decision happen before any vendor read.
  test('a linked account with only inbound fields changed makes no AccuLynx call', async () => {
    const fake = fakeAccuLynx({})
    const terros = fakeLinkedTerros(savedState())
    await sendAccount(
      account({
        externalLeadId: 'contact-1',
        workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Approved' },
        closer: owner(),
        customFieldMap: { 'CF.syncstate': savedState() },
      }),
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      fake.client,
      terros.terros
    )

    expect(fake.calls).toEqual([])
    expect(terros.updates).toEqual([])
  })

  // Prevents duplicate contacts while applying every supported contact change, and avoids add-only phone/email
  // duplicates by reading those collections first.
  test('updates an existing contact and saves a snapshot that makes the next event a no-op', async () => {
    const changed = account({
      externalLeadId: 'contact-1',
      resident: {
        firstName: 'Taylor',
        lastName: 'Example',
        businessName: 'Acme Roofing',
        email: 'user@example.test',
        phone: '312-555-0199',
      },
      address: { ...account().address!, line1: '2 Main St' },
      customFieldMap: { 'CF.syncstate': savedState() },
    })
    const fake = fakeAccuLynx({
      'GET /contacts/contact-1': {
        body: {
          id: 'contact-1',
          firstName: 'Pat',
          lastName: 'Example',
          companyName: '',
          mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
        },
      },
      'GET /contacts/contact-1/email-addresses': { body: { items: [{ address: 'pat@example.test' }] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [{ number: '3125550100' }] } },
      'PUT /contacts/contact-1': { status: 204 },
      'POST /contacts/contact-1/email-addresses': { status: 201 },
      'POST /contacts/contact-1/phone-numbers': { status: 201 },
    })
    const terros = fakeLinkedTerros(savedState())

    await sendAccount(
      changed,
      { recordType: 'contact', syncUpdates: 'yes', syncStateFieldId: 'CF.syncstate' },
      fake.client,
      terros.terros
    )

    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /contacts/contact-1',
      'PUT /contacts/contact-1',
      'GET /contacts/contact-1/email-addresses',
      'GET /contacts/contact-1/phone-numbers',
      'POST /contacts/contact-1/email-addresses',
      'POST /contacts/contact-1/phone-numbers',
    ])
    expect(fake.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      firstName: 'Taylor',
      companyName: 'Acme Roofing',
      mailingAddress: { street1: '2 Main St' },
    })
    const state = (terros.updates[0] as { account: { customFieldsPatch: Record<string, string> } }).account
      .customFieldsPatch['CF.syncstate']

    const second = fakeAccuLynx({})
    await sendAccount(
      { ...changed, customFieldMap: { 'CF.syncstate': state! } },
      { recordType: 'contact', syncUpdates: 'on', syncStateFieldId: 'CF.syncstate' },
      second.client,
      fakeLinkedTerros(state!).terros
    )
    expect(second.calls).toEqual([])
  })

  // Prevents state/country returned by AccuLynx from making a partial mailing-address update look necessary.
  test('compares only mailing-address fields present in the contact update payload', async () => {
    const prior = savedState()
    const changed = account({
      externalLeadId: 'contact-1',
      resident: { ...account().resident, email: 'user@example.test' },
      customFieldMap: { 'CF.syncstate': prior },
    })
    const fake = fakeAccuLynx({
      'GET /contacts/contact-1': {
        body: {
          id: 'contact-1',
          firstName: 'Pat',
          lastName: 'Example',
          companyName: '',
          crossReference: 'Account.example',
          contactTypeIds: ['type-example'],
          mailingAddress: {
            street1: '1 Main St',
            city: 'Springfield',
            state: { abbreviation: 'IL' },
            country: { abbreviation: 'US' },
            zipCode: '62701',
          },
        },
      },
      'GET /contacts/contact-1/email-addresses': { body: { items: [{ address: 'pat@example.test' }] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [{ number: '3125550100' }] } },
      'POST /contacts/contact-1/email-addresses': { status: 201 },
    })

    await sendAccount(
      changed,
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      fake.client,
      fakeLinkedTerros(prior).terros
    )

    expect(fake.calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  // Prevents an unavailable inferred contact-update endpoint from blocking documented phone, email, and note writes,
  // while retaining the old fingerprint so the basic fields are retried.
  test('continues independent writes when a basic contact update fails and retries its fingerprint', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const prior = savedState()
    const note = { noteId: 'Note.example-new' as const, text: 'New note', timestamp: 2, userId: 'U.example' as const }
    const changed = account({
      externalLeadId: 'contact-1',
      resident: { ...account().resident, firstName: 'Taylor', email: 'user@example.test' },
      notes: [note],
      customFieldMap: { 'CF.syncstate': prior },
    })
    const replies = {
      'GET /contacts/contact-1': {
        body: {
          id: 'contact-1',
          firstName: 'Pat',
          lastName: 'Example',
          companyName: '',
          crossReference: 'Account.example',
          contactTypeIds: ['type-example'],
          mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
        },
      },
      'PUT /contacts/contact-1': { status: 404, body: { message: 'Entity not found' } },
      'GET /contacts/contact-1/email-addresses': { body: { items: [] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [{ number: '3125550100' }] } },
      'POST /contacts/contact-1/email-addresses': { status: 201 },
      'POST /contacts/contact-1/notes': { status: 201 },
    }
    const terros = fakeLinkedTerros(prior)
    const first = fakeAccuLynx(replies)

    await sendAccount(
      changed,
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      first.client,
      terros.terros
    )

    expect(first.calls.map((call) => `${call.method} ${call.path}`)).toContain('POST /contacts/contact-1/notes')
    expect(first.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      crossReference: 'Account.example',
      contactTypeIds: ['type-example'],
    })
    const checkpoint = JSON.parse(
      (terros.updates[0] as { account: { customFieldsPatch: Record<string, string> } }).account.customFieldsPatch[
        'CF.syncstate'
      ]!
    ) as { fingerprint: string; sentNoteIds: string[] }
    expect(checkpoint).toMatchObject({
      fingerprint: JSON.parse(prior).fingerprint,
      sentNoteIds: ['Note.example-new'],
    })

    const retry = fakeAccuLynx({ ...replies, 'GET /contacts/contact-1/email-addresses': { body: { items: [] } } })
    await sendAccount(
      changed,
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      retry.client,
      terros.terros
    )
    expect(retry.calls.map((call) => `${call.method} ${call.path}`)).toContain('PUT /contacts/contact-1')
    expect(retry.calls.map((call) => `${call.method} ${call.path}`)).not.toContain('POST /contacts/contact-1/notes')
    error.mockRestore()
  })

  // Prevents triggerStages from stranding linked jobs after they advance, while retaining the location filter.
  test('updates a linked job outside the trigger stage and skips one outside the account filter', async () => {
    const changed = account({
      externalLeadId: 'job-1',
      workflowState: { workflowId: 'WF.north', stageId: 'S.example', stageName: 'Installed' },
      address: { ...account().address!, line1: '2 Main St', country: 'US' },
      customFieldMap: { 'CF.syncstate': savedState([], { job: true, leadSourceId: 'source-old' }) },
    })
    const replies = {
      'GET /jobs/job-1': {
        body: {
          id: 'job-1',
          contacts: [{ isPrimary: true, contact: { id: 'contact-1', firstName: 'Pat', lastName: 'Example' } }],
          locationAddress: {
            street1: '1 Main St',
            city: 'Springfield',
            state: { abbreviation: 'IL' },
            country: { abbreviation: 'US' },
            zipCode: '62701',
          },
          leadSource: { id: 'source-old' },
        },
      },
      'GET /contacts/contact-1/email-addresses': { body: { items: [{ address: 'pat@example.test' }] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [{ number: '3125550100' }] } },
      'GET /contacts/contact-1': {
        body: {
          id: 'contact-1',
          firstName: 'Pat',
          lastName: 'Example',
          companyName: '',
          mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
        },
      },
      'PUT /contacts/contact-1': { status: 204 },
      'PUT /jobs/job-1/address': { status: 204 },
      'PUT /jobs/job-1/lead-source': { status: 204 },
    }
    const fake = fakeAccuLynx(replies)
    await sendAccount(
      changed,
      {
        recordType: 'job',
        syncUpdates: '1',
        syncStateFieldId: 'CF.syncstate',
        triggerStages: 'Sold',
        leadSourceId: 'source-new',
      },
      fake.client,
      fakeLinkedTerros(savedState([], { job: true, leadSourceId: 'source-old' })).terros
    )
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toContain('PUT /jobs/job-1/address')
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toContain('PUT /jobs/job-1/lead-source')

    const filtered = fakeAccuLynx(replies)
    await sendAccount(
      changed,
      {
        recordType: 'job',
        syncUpdates: 'true',
        syncStateFieldId: 'CF.syncstate',
        accountFilterField: 'workflowState.workflowId',
        accountFilterValues: 'WF.south',
      },
      filtered.client,
      fakeTerros().terros
    )
    expect(filtered.calls).toEqual([])
  })

  // Prevents retrying every historical note and proves each new note is persisted after one append.
  test.each([
    { recordType: 'job' as const, linkedId: 'job-1', writePath: '/jobs/job-1/messages' },
    { recordType: 'contact' as const, linkedId: 'contact-1', writePath: '/contacts/contact-1/notes' },
  ])('posts a new $recordType note once and includes its noteId', async ({ recordType, linkedId, writePath }) => {
    const oldNote = {
      noteId: 'Note.example-old' as const,
      text: 'Already sent',
      timestamp: 1,
      userId: 'U.example' as const,
    }
    const newNote = {
      noteId: 'Note.example-new' as const,
      text: recordType === 'contact' ? 'x'.repeat(1100) : 'New note',
      timestamp: 2,
      userId: 'U.example' as const,
    }
    const input = account({
      externalLeadId: linkedId,
      notes: [oldNote, newNote],
      customFieldMap: {
        'CF.syncstate': savedState(['Note.example-old'], recordType === 'job' ? { job: true, country: 'US' } : {}),
      },
    })
    const replies = {
      ...(recordType === 'job'
        ? {
            'GET /jobs/job-1': {
              body: {
                id: 'job-1',
                contacts: [{ isPrimary: true, contact: { id: 'contact-1', firstName: 'Pat', lastName: 'Example' } }],
                locationAddress: {
                  street1: '1 Main St',
                  city: 'Springfield',
                  state: { abbreviation: 'IL' },
                  country: { abbreviation: 'US' },
                  zipCode: '62701',
                },
              },
            },
          }
        : {
            'GET /contacts/contact-1': {
              body: {
                id: 'contact-1',
                firstName: 'Pat',
                lastName: 'Example',
                mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
              },
            },
          }),
      'GET /contacts/contact-1/email-addresses': { body: { items: [{ address: 'pat@example.test' }] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [{ number: '3125550100' }] } },
      ...(recordType === 'job'
        ? {
            'GET /contacts/contact-1': {
              body: {
                id: 'contact-1',
                firstName: 'Pat',
                lastName: 'Example',
                companyName: '',
                mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
              },
            },
          }
        : {}),
      [`POST ${writePath}`]: { status: 201 },
    }
    const fake = fakeAccuLynx(replies)
    const initialState = savedState(['Note.example-old'], recordType === 'job' ? { job: true, country: 'US' } : {})
    const terros = fakeLinkedTerros(initialState)
    await sendAccount(
      input,
      { recordType, syncUpdates: 'true', syncStateFieldId: 'CF.syncstate', addressCountry: 'US' },
      fake.client,
      terros.terros
    )

    const noteCall = fake.calls.find((call) => call.path === writePath)
    if (recordType === 'job') {
      expect(noteCall?.body).toEqual({ message: 'Terros note Note.example-new\nNew note' })
    } else {
      const posted = (noteCall?.body as { note: string }).note
      expect(posted).toHaveLength(1000)
      expect(posted).toMatch(/^Terros note Note\.example-new\n/)
    }
    const state = (terros.updates[0] as { account: { customFieldsPatch: Record<string, string> } }).account
      .customFieldsPatch['CF.syncstate']
    const second = fakeAccuLynx({})
    await sendAccount(
      { ...input, customFieldMap: { 'CF.syncstate': state! } },
      { recordType, syncUpdates: 'true', syncStateFieldId: 'CF.syncstate', addressCountry: 'US' },
      second.client,
      fakeLinkedTerros(state!).terros
    )
    expect(second.calls).toEqual([])
  })

  // Prevents checkpoint webhook snapshots and queued pre-sync events from reposting later notes.
  test('replayed checkpoint snapshots do not repost either of two new notes', async () => {
    const prior = savedState()
    const notes = [
      { noteId: 'Note.example-one' as const, text: 'First note', timestamp: 1, userId: 'U.example' as const },
      { noteId: 'Note.example-two' as const, text: 'Second note', timestamp: 2, userId: 'U.example' as const },
    ]
    const input = account({
      externalLeadId: 'contact-1',
      notes,
      customFieldMap: { 'CF.syncstate': prior },
    })
    const replies = {
      'GET /contacts/contact-1': {
        body: {
          id: 'contact-1',
          firstName: 'Pat',
          lastName: 'Example',
          companyName: '',
          mailingAddress: { street1: '1 Main St', city: 'Springfield', zipCode: '62701' },
        },
      },
      'GET /contacts/contact-1/email-addresses': { body: { items: [{ address: 'pat@example.test' }] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [{ number: '3125550100' }] } },
      'POST /contacts/contact-1/notes': { status: 201 },
    }
    const terros = fakeLinkedTerros(prior)
    const first = fakeAccuLynx(replies)
    await sendAccount(
      input,
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      first.client,
      terros.terros
    )
    const firstCheckpoint = (terros.updates[0] as { account: { customFieldsPatch: Record<string, string> } }).account
      .customFieldsPatch['CF.syncstate']!

    const replay = fakeAccuLynx({})
    await sendAccount(
      { ...input, customFieldMap: { 'CF.syncstate': firstCheckpoint } },
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate' },
      replay.client,
      terros.terros
    )

    expect(first.calls.filter((call) => call.path === '/contacts/contact-1/notes')).toHaveLength(2)
    expect(replay.calls).toEqual([])
  })

  // Prevents dry-run validation from writing either system while still showing the exact planned update.
  test('test mode logs linked-account writes without performing them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fake = fakeAccuLynx({
      'GET /company-settings': { body: { companyId: 'company-example', name: 'Acme Roofing' } },
      'GET /contacts/contact-1': { body: { id: 'contact-1', firstName: 'Pat' } },
      'GET /contacts/contact-1/email-addresses': { body: { items: [] } },
      'GET /contacts/contact-1/phone-numbers': { body: { items: [] } },
    })
    const terros = fakeLinkedTerros(savedState())
    await sendAccount(
      account({
        externalLeadId: 'contact-1',
        resident: { ...account().resident, firstName: 'Taylor' },
        customFieldMap: { 'CF.syncstate': savedState() },
      }),
      { recordType: 'contact', syncUpdates: 'true', syncStateFieldId: 'CF.syncstate', testMode: 'true' },
      fake.client,
      terros.terros
    )
    expect(fake.calls.every((call) => call.method === 'GET')).toBe(true)
    expect(terros.updates).toEqual([])
    expect(log.mock.calls.flat().join('\n')).toContain('DRY RUN: would update AccuLynx')
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

  test('syncUpdates accepts only explicit on values and fails closed on unknown text', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(['true', 'yes', 'on', '1'].every((value) => isSyncUpdatesOn(value))).toBe(true)
    expect(['', 'false', 'no', 'off', '0'].every((value) => !isSyncUpdatesOn(value))).toBe(true)
    expect(isSyncUpdatesOn('ture')).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('treating it as false'))
    error.mockRestore()
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
