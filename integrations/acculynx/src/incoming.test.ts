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
  'GET /jobs/job-1/milestones/current': { body: { name: 'Approved', duration: { startDate: '2026-01-05T19:00:00Z' } } },
}
const linked = {
  ...current,
  'GET /jobs/external-references': { body: [{ jobId: 'job-1', source: 'Terros', projectId: 'Account.example' }] },
}
const unlinked = { ...current, 'GET /jobs/external-references': { body: [] } }

describe('receiveWebhook', () => {
  // Prevents a milestone change from landing on the wrong account, or with the webhook arrival time.
  test('moves the linked Terros account to the milestone', async () => {
    const { client, calls } = fakeAccuLynx(linked)
    const { terros, upserts } = fakeTerros()

    await receiveWebhook(milestoneEvent(), { workflowId: 'WF.example', requestType: 'upsert' }, client, terros)

    expect(calls.map((call) => call.path)).toEqual(['/jobs/job-1/milestones/current', '/jobs/external-references'])
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

    const unknown = fakeAccuLynx({ 'GET /jobs/job-2/milestones/current': { status: 404 } })
    const unknownTerros = fakeTerros()
    const event = milestoneEvent({ event: { job: { id: 'job-2', milestone: { name: 'Approved' } } } })
    await receiveWebhook(
      event,
      { workflowId: 'WF.example', requestType: 'upsert' },
      unknown.client,
      unknownTerros.terros
    )

    expect(unknown.calls.map((call) => call.path)).toEqual(['/jobs/job-2/milestones/current'])
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
