import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handler as accountSync, isOpportunityStage } from './outgoing.ts'
import { FakeApis, LOCATION_ID, makeInput, PIPELINE_ID } from './fakeApis.ts'

const config = { locationId: LOCATION_ID, pipelineId: PIPELINE_ID }
const ALERT_URL = 'https://alerts.example.com/hook'
let fake: FakeApis
let error: ReturnType<typeof vi.spyOn>
let alertPosts: unknown[]

beforeEach(() => {
  fake = new FakeApis()
  fake.install()
  alertPosts = []
  const fakeFetch = fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === ALERT_URL) {
      alertPosts.push(JSON.parse(init!.body as string))
      return new Response('{}')
    }
    return fakeFetch(url, init)
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sync = (cfg: Record<string, unknown> = config, id = 'Account.1') =>
  accountSync(makeInput(fake.accountWebhook(id), cfg))

function account(extra: Record<string, unknown> = {}) {
  return fake.addAccount({ accountId: 'Account.1', externalLeadId: 'c-1', ...extra })
}

describe('Account Sync creates the missing opportunity', () => {
  beforeEach(() => fake.addContact('c-1'))

  test('in the default Appointment Set stage', async () => {
    account()
    await sync()
    expect([...fake.ghl.opps.values()]).toEqual([
      expect.objectContaining({ contactId: 'c-1', pipelineStageId: 'st-appt', status: 'open' }),
    ])
  })

  test('uses stageMappings for the GHL stage', async () => {
    account()
    await sync({ ...config, stageMappings: { 'Appointment Set': 'Sat' } })
    expect([...fake.ghl.opps.values()].map((o) => o.pipelineStageId)).toEqual(['st-sat'])
  })

  test('does not create one in a stage that is not configured', async () => {
    account({ workflowStageName: 'Sat' })
    await sync()
    expect(fake.ghl.opps.size).toBe(0)
  })

  test('creates one in every configured later stage', async () => {
    account({ workflowStageName: 'Sat' })
    await sync({ ...config, opportunityStages: 'Appointment Set, sat' })
    expect([...fake.ghl.opps.values()].map((o) => o.pipelineStageId)).toEqual(['st-sat'])
  })

  test('does not fail on an account with no stage', async () => {
    account({ workflowStageName: undefined })
    await sync()
    expect(fake.ghl.opps.size).toBe(0)
    expect(fake.ghl.contacts.size).toBe(1)
  })

  test('a repeated save does not create a second opportunity', async () => {
    account()
    await sync()
    await sync()
    expect(fake.ghl.opps.size).toBe(1)
  })

  test('re-reads right before creating, so a concurrent create is not duplicated', async () => {
    account()
    // The first look finds nothing; another run creates the opportunity before this one posts.
    const search = vi.fn()
    const base = fetch
    let searches = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('/opportunities/search') && ++searches === 1) {
        const empty = await base(url, init)
        fake.addOpp('opp-race', 'c-1', 'st-appt')
        search()
        return empty
      }
      return base(url, init)
    })

    await sync()

    expect(search).toHaveBeenCalledOnce()
    expect(fake.ghl.opps.size).toBe(1)
    expect(fake.ghlWrites().filter((line) => line.includes('POST /opportunities'))).toEqual([])
  })

  test('saves the opportunity id to the configured custom field once', async () => {
    account()
    const cfg = { ...config, opportunityIdFieldId: 'CF.oppId' }
    await sync(cfg)
    const [oppId] = [...fake.ghl.opps.keys()]
    expect(fake.terros.accounts.get('Account.1')!.customFields).toEqual({ 'CF.oppId': oppId })

    fake.log.length = 0
    await sync(cfg)
    expect(fake.terrosWrites()).toEqual([])
  })

  test('does not write the id without a configured field', async () => {
    account()
    await sync()
    expect(fake.terros.accounts.get('Account.1')!.customFields).toBeUndefined()
  })

  test('an existing opportunity keeps its stage and status', async () => {
    account()
    fake.addOpp('opp-1', 'c-1', 'st-won', { status: 'won' })
    await sync()
    expect(fake.ghl.opps.get('opp-1')).toMatchObject({ pipelineStageId: 'st-won', status: 'won' })
    expect(fake.ghl.opps.size).toBe(1)
  })
})

describe('default opportunity stages', () => {
  test.each([
    [undefined, 'Appointment Set', true],
    ['', ' appointment set ', true],
    [undefined, 'Sat', false],
    ['Sat,Closed Won', 'closed won', true],
    ['Sat', 'Appointment Set', false],
    [undefined, undefined, false],
  ])('configured %j, stage %j -> %j', (configured, stage, expected) => {
    expect(isOpportunityStage(stage, configured)).toBe(expected)
  })
})

describe('Account Sync waits for the closer', () => {
  const alertConfig = { ...config, alertWebhookUrl: ALERT_URL, alertRecipients: 'a@example.test, b@example.test' }

  test('skips an account in an opportunity stage with no closer, without alerting or writing', async () => {
    fake.addContact('c-1')
    account({ closer: undefined })
    await sync(alertConfig)

    expect(error).not.toHaveBeenCalled()
    expect(alertPosts).toEqual([])
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([])
    expect(fake.terrosWrites()).toEqual([])
    expect(fake.ghlWrites()).toEqual([])
  })

  test("syncs on the closer's webhook, which follows the closer-less stage change", async () => {
    fake.addContact('c-1')
    account({ closer: undefined })
    await sync(alertConfig)
    fake.terros.accounts.get('Account.1')!.closer = { userId: 'U.closer', email: 'closer@example.test' }
    await sync(alertConfig)

    expect([...fake.ghl.opps.values()]).toEqual([
      expect.objectContaining({ contactId: 'c-1', pipelineStageId: 'st-appt', assignedTo: 'ghl-closer' }),
    ])
    expect(alertPosts).toEqual([])
  })

  test('reads owner and closer from the webhook payload, where they are objects', async () => {
    fake.addContact('c-1')
    account()
    const webhook = fake.accountWebhook('Account.1')
    expect(webhook.data).toMatchObject({ owner: { userId: 'U.owner' }, closer: { userId: 'U.closer' } })
    expect(webhook.data).not.toHaveProperty('ownerId')
    expect(webhook.data).not.toHaveProperty('closerId')
    await accountSync(makeInput(webhook, config))
    expect([...fake.ghl.opps.values()]).toEqual([expect.objectContaining({ assignedTo: 'ghl-closer' })])
  })
})
