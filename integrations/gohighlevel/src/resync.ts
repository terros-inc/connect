import {
  type AccountData,
  type AccountId,
  type CalendarEventDataWithDetails,
  type CustomFieldId,
  type TerrosClient,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { createOpportunityIfMissing, isOpportunityStage, type OpportunityConfig } from './opportunity.ts'
import { findOpportunity, findStage, findUserId, getPipeline } from './gohighlevel.ts'
import { isCreatingMarker, isFreshMarker, realSourceId } from './creationGuard.ts'
import { ensureContactId, findValidContactId } from './contact.ts'
import { checkConfig } from './configFields.ts'
import { isSwitchOn, toGhlStage, type RunSwitches } from './config.ts'
import { readCompanyId } from './calendarIncoming.ts'
import { createGuardedAppointment, findAppointment } from './calendar.ts'
import { sendAlert, type AlertConfig } from './alerts.ts'

type ScriptConfig = RunSwitches &
  AlertConfig &
  OpportunityConfig & {
    calendarId: string
    contactFieldMappings?: Record<string, string>
    opportunityStages?: string
    mode?: string
    horizonDays?: string | number
    maxRecords?: string | number
    timeBudgetSeconds?: string | number
  }

type Secrets = {
  privateIntegrationToken: string
}

/** The request body. Only these keys are read, and only to change one run; switches are never read from it. */
type ResyncPayload = {
  mode?: unknown
  horizonDays?: unknown
  maxRecords?: unknown
}

type Mode = 'report' | 'repair'
type Action = 'would_create' | 'created' | 'skipped' | 'error'
type Kind = 'appointment' | 'account'

export type ResyncSettings = {
  mode: Mode
  horizonDays: number
  maxRecords: number
  timeBudgetMs: number
}

export const DEFAULT_HORIZON_DAYS = 14
const MAX_HORIZON_DAYS = 60
export const DEFAULT_MAX_RECORDS = 25
const MAX_MAX_RECORDS = 100
// The script platform stops a run at 60 s. A record already started can take a few GoHighLevel calls (a second or
// two each), so new records stop well before that.
export const DEFAULT_TIME_BUDGET_SECONDS = 40
const MAX_TIME_BUDGET_SECONDS = 50
const DAY_MS = 24 * 60 * 60 * 1000
const ACCOUNT_PAGE_SIZE = 500
const MAX_ACCOUNT_PAGES = 6

function readCount(name: string, value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return fallback
  const count = Number(value)
  if (!Number.isFinite(count) || count < 1) {
    console.error(`Config ${name} is "${value}", expected a number from 1 to ${max}; using ${fallback}`)
    return fallback
  }
  return Math.min(Math.floor(count), max)
}

/**
 * Anything that is not exactly repair is report, so a typo can only write less. A run's request body may change the
 * mode, horizon and cap for that run; the install config supplies everything else.
 */
export function readSettings(config: ScriptConfig, payload: ResyncPayload | undefined): ResyncSettings {
  const modeText = String(payload?.mode ?? config.mode ?? '')
    .trim()
    .toLowerCase()
  if (modeText && modeText !== 'report' && modeText !== 'repair') {
    console.error(`Config mode is "${modeText}", expected report or repair; treating it as report`)
  }
  return {
    mode: modeText === 'repair' ? 'repair' : 'report',
    horizonDays: readCount(
      'horizonDays',
      payload?.horizonDays ?? config.horizonDays,
      DEFAULT_HORIZON_DAYS,
      MAX_HORIZON_DAYS
    ),
    maxRecords: readCount('maxRecords', payload?.maxRecords ?? config.maxRecords, DEFAULT_MAX_RECORDS, MAX_MAX_RECORDS),
    timeBudgetMs:
      readCount('timeBudgetSeconds', config.timeBudgetSeconds, DEFAULT_TIME_BUDGET_SECONDS, MAX_TIME_BUDGET_SECONDS) *
      1000,
  }
}

type Counts = {
  eventsInHorizon: number
  accountsScanned: number
  accountsInScope: number
  would_create: number
  created: number
  skipped: number
  errors: number
  /** Events whose linked GoHighLevel appointment could not be found. Never recreated, see resyncEvent. */
  linkMissing: number
}

type Run = {
  client: TerrosClient
  accessToken: string
  config: ScriptConfig
  settings: ResyncSettings
  /** Report mode, or dryRun on: nothing is written. */
  readOnly: boolean
  startedAt: number
  counts: Counts
  more: boolean
  closerIds: Map<string, Promise<string | undefined>>
}

// One structured line per record. It carries ids and short codes only: never a name, email, phone or address.
function logRecord(run: Run, kind: Kind, id: string, action: Action, reason: string): void {
  if (action === 'would_create') run.counts.would_create++
  else if (action === 'created') run.counts.created++
  else if (action === 'error') run.counts.errors++
  else run.counts.skipped++
  console.log(`GHL_RESYNC ${JSON.stringify({ mode: run.settings.mode, kind, id, action, reason })}`)
}

/** Records the run has acted on, or failed on, against the per-run cap. In-sync skips are free. */
function acted(run: Run): number {
  return run.counts.would_create + run.counts.created + run.counts.errors
}

/** True when the run must stop starting records: the cap is reached or the time budget is spent. */
function outOfRoom(run: Run): boolean {
  if (acted(run) >= run.settings.maxRecords || Date.now() - run.startedAt >= run.settings.timeBudgetMs) {
    run.more = true
    return true
  }
  return false
}

/** A short code for a failure. GoHighLevel error bodies can hold personal data, so only the status is kept. */
export function errorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = /^GHL request failed: (\d{3})/.exec(message)
  if (status) return `ghl_http_${status[1]}`
  if (message.startsWith('Multiple GoHighLevel opportunities')) return 'multiple_opportunities'
  if (message.startsWith('Multiple GoHighLevel users')) return 'multiple_ghl_users'
  if (message.startsWith('Expected one stage named')) return 'stage_not_found'
  if (message.startsWith('GoHighLevel pipeline')) return 'pipeline_not_found'
  return 'unexpected_error'
}

// The closer lookup is two GoHighLevel calls, so it is made once per closer per run.
function findCloserUserId(run: Run, email: string): Promise<string | undefined> {
  const key = email.trim().toLowerCase()
  let found = run.closerIds.get(key)
  if (!found) {
    found = findUserId(run.accessToken, run.config.locationId, email)
    run.closerIds.set(key, found)
  }
  return found
}

export const handler = wrapConnectHandler<ResyncPayload | undefined, void, ScriptConfig>(async (input, client) => {
  const config = input.context.config.scriptConfig
  const accessToken = (input.context.config.secrets as Secrets).privateIntegrationToken
  if (isSwitchOn('disabled', config.disabled)) {
    console.log('GoHighLevel Resync is disabled by config, skipping')
    return
  }
  checkConfig('resync', config)
  const dryRun = isSwitchOn('dryRun', config.dryRun)
  const payload = typeof input.context.payload === 'object' ? input.context.payload : undefined
  const settings = readSettings(config, payload)

  const run: Run = {
    client,
    accessToken,
    config,
    settings,
    readOnly: settings.mode !== 'repair' || dryRun,
    startedAt: Date.now(),
    counts: {
      eventsInHorizon: 0,
      accountsScanned: 0,
      accountsInScope: 0,
      would_create: 0,
      created: 0,
      skipped: 0,
      errors: 0,
      linkMissing: 0,
    },
    more: false,
    closerIds: new Map(),
  }

  // Appointments first: an event that is about to happen is the most urgent, and the account pass gets what is left.
  await resyncEvents(run)
  await resyncAccounts(run)

  await summarize(run, dryRun)
})

async function summarize(run: Run, dryRun: boolean): Promise<void> {
  const { counts, settings } = run
  const summary = {
    mode: settings.mode,
    dryRun,
    wrote: !run.readOnly,
    horizonDays: settings.horizonDays,
    maxRecords: settings.maxRecords,
    ...counts,
    more: run.more,
    ms: Date.now() - run.startedAt,
  }
  console.log(`GHL_RESYNC_SUMMARY ${JSON.stringify(summary)}`)

  const verb = run.readOnly ? 'would create' : 'created'
  const made = run.readOnly ? counts.would_create : counts.created
  const written = run.readOnly
    ? `Nothing was written (${dryRun ? 'dryRun is on' : 'report mode'}).`
    : 'Notifications to customers were off for appointments created.'
  await sendAlert(run.config, {
    stage: 'Resync',
    message:
      `GoHighLevel Resync (${settings.mode}${dryRun ? ', dryRun' : ''}): ${verb} ${made}, skipped ${counts.skipped}, ` +
      `errors ${counts.errors}, linked appointments not found ${counts.linkMissing}. ${written} ` +
      (run.more ? 'More remain: run it again.' : 'Nothing more remains in scope.'),
  })
}

// --- Appointments: upcoming Consultation events with no GoHighLevel appointment ---------------------------------

async function resyncEvents(run: Run): Promise<void> {
  const now = Date.now()
  // Scoped to the company, because without a companyId the list returns only the key user's own events.
  const companyId = await readCompanyId(run.client)
  let events: CalendarEventDataWithDetails[]
  try {
    const listed = await run.client.calendar.event.list({
      companyId,
      eventType: 'Consultation',
      startTime: now,
      endTime: now + run.settings.horizonDays * DAY_MS,
    })
    events = listed.events
  } catch (error) {
    logRecord(run, 'appointment', 'event-list', 'error', errorReason(error))
    return
  }

  // Never a past event, and the soonest first so a short run still covers what matters most.
  const upcoming = events
    .filter((event) => new Date(event.eventDate).getTime() >= now)
    .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime())
  run.counts.eventsInHorizon = upcoming.length

  for (const event of upcoming) {
    if (outOfRoom(run)) return
    try {
      await resyncEvent(run, event)
    } catch (error) {
      logRecord(run, 'appointment', event.eventId, 'error', errorReason(error))
    }
  }
}

async function resyncEvent(run: Run, event: CalendarEventDataWithDetails): Promise<void> {
  const { client, accessToken, config } = run
  const id = event.eventId
  if (!event.accountId) return logRecord(run, 'appointment', id, 'skipped', 'no_account')
  const closerEmail = event.attendee?.email
  if (!closerEmail) return logRecord(run, 'appointment', id, 'skipped', 'no_attendee')
  if (isFreshMarker(event.sourceId, Date.now())) {
    return logRecord(run, 'appointment', id, 'skipped', 'create_in_flight')
  }

  const linkedAppointmentId = realSourceId(event.sourceId)
  if (linkedAppointmentId) {
    // Never create over a link. A lookup that finds nothing can be a lag, a wrong reply shape or a deleted
    // appointment, and a replacement would write the event and trigger Appointment Sync again. Appointment Sync
    // refuses the same way; a person clears the event's link to have this script create a new one.
    const existing = await findAppointment(accessToken, linkedAppointmentId)
    if (existing) return logRecord(run, 'appointment', id, 'skipped', 'in_sync')
    run.counts.linkMissing++
    return logRecord(run, 'appointment', id, 'skipped', 'linked_appointment_not_found')
  }
  if (isCreatingMarker(event.sourceId)) {
    // An expired marker means an earlier create was claimed and never finished; the attempt count decides below.
    console.log(`Event ${id} holds an expired create marker`)
  }

  const assignedUserId = await findCloserUserId(run, closerEmail)
  if (!assignedUserId) return logRecord(run, 'appointment', id, 'skipped', 'no_ghl_user')

  const { account } = await client.account.get({ accountId: event.accountId })
  const created = await createGuardedAppointment({
    client,
    accessToken,
    config,
    event: {
      id,
      title: event.title,
      eventDate: new Date(event.eventDate).toISOString(),
      duration: event.duration,
    },
    account,
    closerUserId: event.attendee?.userId,
    assignedUserId,
    // A backfilled appointment must not message the closer or the homeowner about something already arranged.
    notify: false,
    dryRun: run.readOnly,
  })
  switch (created.status) {
    case 'dry_run':
      return logRecord(run, 'appointment', id, 'would_create', 'no_appointment_link')
    case 'created':
      return logRecord(run, 'appointment', id, 'created', 'no_appointment_link')
    case 'raced':
      return logRecord(run, 'appointment', id, 'skipped', 'create_in_flight')
    case 'refused':
      return logRecord(run, 'appointment', id, 'skipped', created.reason)
  }
}

// --- Accounts: a closer and a configured stage, but no contact or no opportunity -------------------------------

async function resyncAccounts(run: Run): Promise<void> {
  const { client, config } = run
  const idFieldId =
    config.opportunityIdFieldId?.startsWith('CF.') === true ? (config.opportunityIdFieldId as CustomFieldId) : undefined

  let cursor: number | number[] | undefined
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
    if (outOfRoom(run)) return
    let listed
    try {
      listed = await client.account.list({
        size: ACCOUNT_PAGE_SIZE,
        searchInput: {
          sortBy: 'lastUpdatedDate',
          sortOrder: 'desc',
          ...(cursor === undefined ? {} : { sortTimestamp: cursor }),
        },
      })
    } catch (error) {
      logRecord(run, 'account', 'account-list', 'error', errorReason(error))
      return
    }

    for (const listedAccount of listed.accounts) {
      run.counts.accountsScanned++
      if (!isOpportunityStage(listedAccount.workflowStageName, config.opportunityStages)) continue
      run.counts.accountsInScope++
      // Linked and holding the opportunity id: nothing to check and nothing to say.
      if (listedAccount.externalLeadId && idFieldId && listedAccount.customFields?.[idFieldId]) continue
      if (outOfRoom(run)) return
      try {
        await resyncAccount(run, listedAccount.accountId)
      } catch (error) {
        logRecord(run, 'account', listedAccount.accountId, 'error', errorReason(error))
      }
    }

    cursor = listed.sortTimestamp
    if (listed.accounts.length < ACCOUNT_PAGE_SIZE || cursor === undefined) return
  }
  // Every page was full, so accounts beyond the last one were not looked at.
  run.more = true
}

async function resyncAccount(run: Run, accountId: AccountId): Promise<void> {
  const { client, accessToken, config } = run
  // The list can lag a save, so decide from a fresh read.
  const { account } = await client.account.get({ accountId })
  if (!isOpportunityStage(account.workflowStageName, config.opportunityStages)) {
    return logRecord(run, 'account', accountId, 'skipped', 'stage_changed')
  }
  const closerEmail = account.closer?.email
  if (!closerEmail) return logRecord(run, 'account', accountId, 'skipped', 'no_closer')
  const assignedTo = await findCloserUserId(run, closerEmail)

  const route = { locationId: config.locationId, pipelineId: config.pipelineId }
  const stageName = account.workflowStageName!
  const contactId = await findValidContactId(accessToken, config.locationId, account.externalLeadId)

  if (run.readOnly) {
    // Look at the pipeline too, so a stage that does not exist shows up in the report rather than at repair time.
    findStage(
      await getPipeline(accessToken, config.locationId, config.pipelineId),
      toGhlStage(stageName, config.stageMappings)
    )
    if (!contactId) return logRecord(run, 'account', accountId, 'would_create', 'no_contact_and_opportunity')
    if (await findOpportunity(accessToken, route, contactId))
      return logRecord(run, 'account', accountId, 'skipped', 'in_sync')
    return logRecord(run, 'account', accountId, 'would_create', 'no_opportunity')
  }

  const hadContact = contactId !== undefined
  const resolvedContactId = hadContact
    ? contactId
    : await ensureContactId(client, accessToken, config, account, assignedTo)
  const created = await createOpportunityOrFind(run, account, resolvedContactId, assignedTo, stageName)
  if (!created) return logRecord(run, 'account', accountId, 'skipped', 'in_sync')
  return logRecord(run, 'account', accountId, 'created', hadContact ? 'opportunity' : 'contact_and_opportunity')
}

/** Creates the opportunity unless one exists; returns whether it created one. */
async function createOpportunityOrFind(
  run: Run,
  account: AccountData,
  contactId: string,
  assignedTo: string | undefined,
  stageName: string
): Promise<boolean> {
  const route = { locationId: run.config.locationId, pipelineId: run.config.pipelineId }
  if (await findOpportunity(run.accessToken, route, contactId)) return false
  const result = await createOpportunityIfMissing(
    run.client,
    run.accessToken,
    run.config,
    { id: account.accountId, resident: account.resident, customFieldMap: account.customFields },
    contactId,
    assignedTo,
    stageName
  )
  return result.created !== undefined
}
