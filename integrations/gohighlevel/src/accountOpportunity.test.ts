import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CLOSER_RECHECK_DELAY_MS, handler as accountSync, isOpportunityStage } from './outgoing.ts'
import { FakeApis, LOCATION_ID, makeInput, PIPELINE_ID } from './fakeApis.ts'
import { ALERT_NOTE_PREFIX } from './alerts.ts'

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
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sync = (cfg: Record<string, unknown> = config, id = 'Account.1') => syncWebhook(cfg, fake.accountWebhook(id))

/** Runs the sync through the closer re-check wait without really waiting. */
async function syncWebhook(cfg: Record<string, unknown>, webhook: unknown) {
  const run = accountSync(makeInput(webhook, cfg))
  await vi.advanceTimersByTimeAsync(CLOSER_RECHECK_DELAY_MS)
  await run
}

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

describe('Account Sync alerts on a qualifying account with no closer', () => {
  const alertConfig = { ...config, alertWebhookUrl: ALERT_URL, alertRecipients: 'a@hq.test, b@hq.test' }

  test('logs, posts to the webhook and records a note once', async () => {
    account({ closer: undefined })
    await sync(alertConfig)

    expect(error).toHaveBeenCalledWith(expect.stringContaining('GHL_SYNC_ALERT'))
    expect(alertPosts).toEqual([
      expect.objectContaining({ accountId: 'Account.1', recipients: ['a@hq.test', 'b@hq.test'] }),
    ])
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([
      expect.objectContaining({ text: expect.stringContaining(ALERT_NOTE_PREFIX), userId: 'U.owner' }),
    ])
    expect(fake.ghl.contacts.size).toBe(0)
  })

  test('does not repeat on the next save', async () => {
    account({ closer: undefined })
    await sync(alertConfig)
    await sync(alertConfig)
    expect(alertPosts).toHaveLength(1)
  })

  test('is a logged alert only when no webhook is configured', async () => {
    account({ closer: undefined })
    await sync()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('GHL_SYNC_ALERT'))
    expect(alertPosts).toEqual([])
  })

  test('a failing webhook does not fail the sync', async () => {
    account({ closer: undefined })
    const base = fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === ALERT_URL) throw new Error('down')
      return base(url, init)
    })
    await expect(sync(alertConfig)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('delivery failed: down'))
  })

  test('stays quiet for a stage that does not qualify', async () => {
    account({ closer: undefined, workflowStageName: 'Sat' })
    await sync(alertConfig)
    expect(error).not.toHaveBeenCalled()
    expect(alertPosts).toEqual([])
  })

  test('the alert note is never copied to GoHighLevel', async () => {
    fake.addContact('c-1')
    account({ closer: undefined })
    await sync(alertConfig)
    fake.terros.accounts.get('Account.1')!.closer = { userId: 'U.closer', email: 'closer@hq.test' }
    await sync(alertConfig)
    expect([...fake.ghl.notes.values()].flat()).toEqual([])
  })
})

describe('Account Sync re-checks a missing closer before alerting', () => {
  const alertConfig = { ...config, alertWebhookUrl: ALERT_URL }
  const closer = { userId: 'U.closer', email: 'closer@hq.test' }
  beforeEach(() => fake.addContact('c-1'))

  test('the payload has owner and closer objects and no ownerId or closerId', () => {
    account()
    expect(fake.accountWebhook('Account.1').data).toMatchObject({
      owner: { userId: 'U.owner' },
      closer: { userId: 'U.closer' },
    })
    expect(fake.accountWebhook('Account.1').data).not.toHaveProperty('ownerId')
    expect(fake.accountWebhook('Account.1').data).not.toHaveProperty('closerId')
  })

  test('a closer that appears a moment later sends no alert and syncs', async () => {
    account({ closer: undefined })
    const webhook = fake.accountWebhook('Account.1')
    // As in production, the booking flow saves only closerId; account.closer stays empty.
    fake.terros.accounts.get('Account.1')!.closerId = closer.userId
    fake.terros.users.set(closer.userId, closer)
    await syncWebhook(alertConfig, webhook)

    expect(alertPosts).toEqual([])
    expect(error).not.toHaveBeenCalled()
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([])
    expect(fake.ghl.contacts.get('c-1')).toMatchObject({ assignedTo: 'ghl-closer' })
    expect([...fake.ghl.opps.values()]).toEqual([
      expect.objectContaining({ pipelineStageId: 'st-appt', assignedTo: 'ghl-closer' }),
    ])
    expect(fake.terros.accounts.get('Account.1')!.externalLeadId).toBeDefined()
  })

  test('a closer that never appears alerts once and records the note as the owner', async () => {
    account({ closer: undefined })
    const webhook = fake.accountWebhook('Account.1')
    await syncWebhook(alertConfig, webhook)
    expect(alertPosts).toHaveLength(1)
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([
      expect.objectContaining({ text: expect.stringContaining(ALERT_NOTE_PREFIX), userId: 'U.owner' }),
    ])

    await syncWebhook(alertConfig, fake.accountWebhook('Account.1'))
    expect(alertPosts).toHaveLength(1)
  })

  test('an alert note saved in the meantime stops a second alert', async () => {
    account({ closer: undefined })
    const webhook = fake.accountWebhook('Account.1')
    fake.terros.accounts.get('Account.1')!.notes = [
      { noteId: 'N.1', timestamp: 1, userId: 'U.owner', text: `${ALERT_NOTE_PREFIX} no closer (Account.1)` },
    ]
    await syncWebhook(alertConfig, webhook)
    expect(alertPosts).toEqual([])
  })

  test('a failed re-read still alerts from the payload', async () => {
    account({ closer: undefined })
    const webhook = fake.accountWebhook('Account.1')
    fake.permissions = new Set(['account:save', 'user:list'])
    await syncWebhook(alertConfig, webhook)
    expect(alertPosts).toHaveLength(1)
  })

  test('an account that already has a closer is not re-read', async () => {
    account()
    await sync(alertConfig)
    expect(fake.log.some((line) => line.includes('account/get'))).toBe(false)
    expect(alertPosts).toEqual([])
  })

  test('a stage that does not create an opportunity is not re-read or alerted', async () => {
    account({ closer: undefined, workflowStageName: 'Sat' })
    await sync(alertConfig)
    expect(alertPosts).toEqual([])
  })

  test('with no owner or closer the note is written as the integration user', async () => {
    account({ closer: undefined, ownerId: undefined, closerId: undefined })
    await syncWebhook(alertConfig, fake.accountWebhook('Account.1'))
    expect(alertPosts).toHaveLength(1)
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([expect.objectContaining({ userId: 'U.connect-key' })])
  })

  test('with no author at all it logs that clearly and still alerts once', async () => {
    fake.terros.profileUserId = undefined
    account({ closer: undefined, ownerId: undefined, closerId: undefined })
    await syncWebhook(alertConfig, fake.accountWebhook('Account.1'))
    expect(alertPosts).toHaveLength(1)
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([])
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Cannot record the alert on Account.1'))
  })

  test('dry run alerts the same way and writes nothing else', async () => {
    account({ closer: undefined })
    await syncWebhook({ ...alertConfig, dryRun: 'true' }, fake.accountWebhook('Account.1'))
    expect(alertPosts).toHaveLength(1)
    expect(fake.ghl.opps.size).toBe(0)
  })

  test('disabled does nothing, not even a re-read', async () => {
    account({ closer: undefined })
    await sync({ ...alertConfig, disabled: 'true' })
    expect(alertPosts).toEqual([])
    expect(fake.terros.accounts.get('Account.1')!.notes).toEqual([])
  })
})
