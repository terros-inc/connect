import { receiveWebhook } from './incoming.ts'
import { fakeAccuLynx, fakeTerros } from './fakeAccuLynx.ts'

// Shape of the job.milestone.current_changed example in the AccuLynx webhook reference.
function milestoneEvent(overrides: Record<string, unknown> = {}) {
  return {
    topicName: 'job.milestone.current_changed',
    eventDateTime: '2026-01-05T19:51:31.0016676Z',
    eventId: 'event-1',
    subscriptionId: 'subscription-a',
    event: {
      job: {
        id: 'job-1',
        _link: 'https://api.acculynx.com/api/v2/jobs/job-1',
        milestone: { id: 'milestone-1', name: 'Approved', date: '2026-01-05T19:00:00Z', isCurrent: true },
      },
    },
    ...overrides,
  }
}

const current = {
  'GET /jobs/job-1/milestones/current?includes=status': {
    body: { name: 'Approved', duration: { startDate: '2026-01-05T19:00:00Z' } },
  },
  'GET /jobs/job-1/representatives/company': { status: 404 },
}
const linked = {
  ...current,
  'GET /jobs/external-references': { body: [{ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' }] },
}
// AccuLynx answers 404, not an empty list, for a job with no Terros reference.
const unlinked = { ...current, 'GET /jobs/external-references': { status: 404 } }

describe('receiveWebhook', () => {
  // Prevents a milestone change from landing on the wrong account, or with the webhook arrival time.
  test('moves the linked Terros account to the milestone', async () => {
    const { client, calls } = fakeAccuLynx(linked)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(milestoneEvent(), { workflowId: 'WF.example', requestType: 'upsert' }, client, terros)

    expect(calls.map((call) => call.path)).toEqual([
      '/jobs/job-1/milestones/current',
      '/jobs/job-1/representatives/company',
      '/jobs/external-references',
    ])
    expect(upserts).toEqual([
      {
        requestType: 'update',
        account: {
          accountId: 'Account.example',
          workflowId: 'WF.example',
          workflowTarget: 'Approved',
          sourceId: 'job-1',
          sourceStatus: 'Approved',
          accountSource: 'AccuLynx',
          externalLeadId: 'job-1',
          lastActionDate: Date.parse('2026-01-05T19:00:00Z'),
        },
      },
    ])
  })

  // Prevents a vendor milestone from selecting a same-named but unrelated Terros stage; sourceStatus still records
  // the vendor's original value.
  test('maps a milestone to the configured stage case-insensitively', async () => {
    const { client } = fakeAccuLynx(linked)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(
      milestoneEvent(),
      {
        workflowId: 'WF.example',
        requestType: 'update',
        milestoneStageMapping: { approved: 'Contract Signed' },
      },
      client,
      terros
    )

    expect(upserts[0]).toMatchObject({
      account: { workflowTarget: 'Contract Signed', sourceStatus: 'Approved' },
    })
  })

  test('trims and maps the current status inside a milestone', async () => {
    const withStatus = {
      ...linked,
      'GET /jobs/job-1/milestones/current?includes=status': {
        body: {
          name: ' Lead ',
          duration: { startDate: '2026-01-05T19:00:00Z' },
          statuses: [
            { name: 'Old status', isCurrent: false },
            { name: ' Appointment Scheduled  ', isCurrent: true },
          ],
        },
      },
    }
    const { client } = fakeAccuLynx(withStatus)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(
      milestoneEvent({ topicName: 'job.milestone.status.current_changed' }),
      {
        workflowId: 'WF.example',
        requestType: 'update',
        milestoneStageMapping: { 'lead > appointment scheduled': 'Appointment Set' },
      },
      client,
      terros
    )

    expect(upserts[0]).toMatchObject({
      account: { workflowTarget: 'Appointment Set', sourceStatus: 'Lead > Appointment Scheduled' },
    })
  })

  test('falls back to a milestone-only mapping when a current status is present', async () => {
    const withStatus = {
      ...linked,
      'GET /jobs/job-1/milestones/current?includes=status': {
        body: {
          name: 'Lead',
          duration: { startDate: '2026-01-05T19:00:00Z' },
          statuses: [{ name: 'Appointment Scheduled', isCurrent: true }],
        },
      },
    }
    const { client } = fakeAccuLynx(withStatus)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(
      milestoneEvent({ topicName: 'job.milestone.status.current_changed' }),
      { workflowId: 'WF.example', requestType: 'update', milestoneStageMapping: { Lead: 'New Lead' } },
      client,
      terros
    )

    expect(upserts[0]).toMatchObject({
      account: { workflowTarget: 'New Lead', sourceStatus: 'Lead > Appointment Scheduled' },
    })
  })

  test('uses the combined milestone and status when no mapping is configured', async () => {
    const withStatus = {
      ...linked,
      'GET /jobs/job-1/milestones/current?includes=status': {
        body: {
          name: 'Prospect',
          duration: { startDate: '2026-01-05T19:00:00Z' },
          statuses: [{ name: 'Inspected - No demo', isCurrent: true }],
        },
      },
    }
    const { client } = fakeAccuLynx(withStatus)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(
      milestoneEvent({ topicName: 'job.milestone.status.current_changed' }),
      { workflowId: 'WF.example', requestType: 'update' },
      client,
      terros
    )

    expect(upserts[0]).toMatchObject({
      account: {
        workflowTarget: 'Prospect > Inspected - No demo',
        sourceStatus: 'Prospect > Inspected - No demo',
      },
    })
  })

  test('matches the company representative to a Terros closer by email case-insensitively', async () => {
    const representative = {
      ...linked,
      'GET /jobs/job-1/representatives/company': { body: { user: { id: 'user-1' } } },
      'GET /users/user-1': { body: { email: 'USER@EXAMPLE.TEST' } },
    }
    const { client } = fakeAccuLynx(representative)
    const closer = {
      userId: 'U.example' as const,
      firstName: 'Pat',
      lastName: 'Example',
      email: 'user@example.test',
    }
    const { terros, upserts } = fakeTerros('success', [closer])

    await receiveWebhook(
      milestoneEvent({ topicName: 'job.representatives.company_assigned' }),
      { workflowId: 'WF.example', requestType: 'update' },
      client,
      terros
    )

    expect(upserts[0]).toMatchObject({ account: { closer } })
  })

  test.each([
    ['the representative has no email', { body: {} }, [{ email: 'user@example.test' }]],
    ['the email matches no Terros user', { body: { email: 'other@example.test' } }, []],
  ])('leaves the closer unchanged when %s', async (_case, userReply, users) => {
    const representative = {
      ...linked,
      'GET /jobs/job-1/representatives/company': { body: { user: { id: 'user-1' } } },
      'GET /users/user-1': userReply,
    }
    const { client } = fakeAccuLynx(representative)
    const terrosUsers = users.map((user) => ({
      userId: 'U.example' as const,
      firstName: 'Pat',
      lastName: 'Example',
      ...user,
    }))
    const { terros, upserts } = fakeTerros('success', terrosUsers)

    await receiveWebhook(
      milestoneEvent({ topicName: 'job.representatives.company_changed' }),
      { workflowId: 'WF.example', requestType: 'update' },
      client,
      terros
    )

    expect((upserts[0] as { account: Record<string, unknown> }).account).not.toHaveProperty('closer')
  })

  test('treats Dead and Cancelled as the same milestone when mapping', async () => {
    const dead = {
      ...linked,
      'GET /jobs/job-1/milestones/current?includes=status': {
        body: { name: 'Dead', duration: { startDate: '2026-01-05T19:00:00Z' } },
      },
    }
    const { client } = fakeAccuLynx(dead)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(
      milestoneEvent(),
      {
        workflowId: 'WF.example',
        requestType: 'update',
        milestoneStageMapping: { Cancelled: 'Closed Lost' },
      },
      client,
      terros
    )

    expect(upserts[0]).toMatchObject({ account: { workflowTarget: 'Closed Lost', sourceStatus: 'Dead' } })
  })

  // Prevents an unmapped status from selecting a stage while still keeping source status and representative changes.
  test('omits the stage for an unmapped status without dropping the rest of the update', async () => {
    const { client, calls } = fakeAccuLynx(linked)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(
      milestoneEvent(),
      { workflowId: 'WF.example', requestType: 'upsert', milestoneStageMapping: { Completed: 'Work Complete' } },
      client,
      terros
    )

    expect(calls.map((call) => call.path)).toEqual([
      '/jobs/job-1/milestones/current',
      '/jobs/job-1/representatives/company',
      '/jobs/external-references',
    ])
    expect(upserts[0]).toMatchObject({ account: { sourceStatus: 'Approved' } })
    expect((upserts[0] as { account: Record<string, unknown> }).account).not.toHaveProperty('workflowTarget')
  })

  // Prevents 'update' mode from creating accounts for jobs that were never sent from Terros.
  test("'update' skips a job with no Terros account", async () => {
    const { client } = fakeAccuLynx(unlinked)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(milestoneEvent(), { workflowId: 'WF.example', requestType: 'update' }, client, terros)

    expect(upserts).toEqual([])
  })

  // Prevents creating blank accounts for jobs started in AccuLynx.
  test("'upsert' creates the account from the job's primary contact and address", async () => {
    const { client } = fakeAccuLynx({
      ...unlinked,
      'GET /jobs/job-1': {
        body: {
          id: 'job-1',
          contacts: [{ isPrimary: true, contact: { firstName: 'Pat', lastName: 'Example' } }],
          locationAddress: {
            street1: '1 Main St',
            city: 'Springfield',
            state: { abbreviation: 'IL' },
            zipCode: '62701',
          },
        },
      },
    })
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(milestoneEvent(), { workflowId: 'WF.example', requestType: 'upsert' }, client, terros)

    expect(upserts[0]).toMatchObject({
      requestType: 'upsert',
      account: {
        accountId: undefined,
        resident: { name: 'Pat Example' },
        location: { line1: '1 Main St', locality: 'Springfield', countrySubd: 'IL', postal1: '62701' },
        workflowTarget: 'Approved',
      },
    })
  })

  // Prevents a forged webhook (AccuLynx does not sign them) from setting any stage or date it likes, or acting on
  // a job this location cannot see.
  test('takes the milestone from AccuLynx, not the body, and ignores a job the key cannot read', async () => {
    const forged = milestoneEvent({
      event: { job: { id: 'job-1', milestone: { name: 'Cancelled', date: '2030-01-01T00:00:00Z' } } },
    })
    const { client } = fakeAccuLynx(linked)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(forged, { workflowId: 'WF.example', requestType: 'update' }, client, terros)

    expect(upserts[0]).toMatchObject({
      account: { workflowTarget: 'Approved', lastActionDate: Date.parse('2026-01-05T19:00:00Z') },
    })

    const unknown = fakeAccuLynx({
      'GET /jobs/job-2/milestones/current?includes=status': { status: 404 },
      'GET /jobs/job-2/representatives/company': { status: 404 },
    })
    const unknownTerros = fakeTerros()
    const event = milestoneEvent({ event: { job: { id: 'job-2', milestone: { name: 'Approved' } } } })
    await receiveWebhook(
      event,
      { workflowId: 'WF.example', requestType: 'upsert' },
      unknown.client,
      unknownTerros.terros
    )

    expect(unknown.calls.map((call) => call.path)).toEqual([
      '/jobs/job-2/milestones/current',
      '/jobs/job-2/representatives/company',
    ])
    expect(unknownTerros.upserts).toEqual([])
  })

  // Prevents one location's install acting on another location's events, a silent default direction, and
  // failures on topics this script does not handle.
  test('refuses another subscription and a missing requestType, and ignores other topics', async () => {
    const { client, calls } = fakeAccuLynx(linked)
    const { terros, upserts } = fakeTerros()
    const config = { workflowId: 'WF.example', requestType: 'update', subscriptionId: 'subscription-b' }

    await expect(receiveWebhook(milestoneEvent(), config, client, terros)).rejects.toThrow('subscription-a')
    await expect(receiveWebhook(milestoneEvent(), { workflowId: 'WF.example' }, client, terros)).rejects.toThrow(
      'requestType'
    )
    await receiveWebhook(
      milestoneEvent({ topicName: 'contact_added' }),
      { ...config, subscriptionId: '' },
      client,
      terros
    )

    expect(calls).toEqual([])
    expect(upserts).toEqual([])
  })
})
