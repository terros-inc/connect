import { DateTime } from 'luxon'
import {
  type AccountData,
  type AccountId,
  IntegrationError,
  type TerrosClient,
  type WorkflowId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { LEADPERFECTION_SOURCE, toZip } from './send.ts'
import {
  fromLeadPerfectionDate,
  type JobStatusChange,
  type LeadLink,
  LeadPerfectionClient,
  readSecrets,
  type SalesAppointment,
  toLeadPerfectionDate,
} from './leadperfection.ts'

export type SyncConfig = {
  workflowId?: string
  resultStages?: Record<string, string>
  jobStatusStages?: Record<string, string>
  requestType?: string
  lookbackDays?: string | number
  timeZone?: string
}

type Terros = Pick<TerrosClient, 'account'>
type LeadPerfection = Pick<LeadPerfectionClient, 'getJobStatusChanges' | 'getSalesAppointments' | 'getLeadLinks'>

// LeadPerfection allows 60 calls a minute and a script run has 60 seconds, so one run stays well under both. Job
// pages are read newest first, so a busy window loses only its oldest changes; customers left over from lookups or
// time wait for the next run, which reads the same overlapping window again.
export const LIMITS = { jobPageSize: 100, jobPages: 5, leadLookups: 40, runMs: 45_000 }

export const handler = wrapConnectHandler<unknown, void, SyncConfig>(async (input, client) => {
  const leadPerfection = new LeadPerfectionClient(readSecrets(input.context.config.secrets))
  await syncResults(input.context.config.scriptConfig, leadPerfection, client)
})

// One LeadPerfection customer as both feeds describe it. Values are LeadPerfection's raw strings.
export type Customer = {
  cstId: string
  result?: string
  apptDate?: string
  entryDate?: string
  jobStatus?: string
  contractDate?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  line1?: string
  city?: string
  state?: string
  zip?: string
}

export type Target = { stageId: string; sourceStatus: string; date?: string }

// LeadPerfection has no webhooks and Connect keeps no cursor between runs, so each run reads an overlapping window
// back from today and changes only accounts that are not already in their target stage.
export async function syncResults(
  config: SyncConfig,
  leadPerfection: LeadPerfection,
  terros: Terros,
  now = Date.now()
): Promise<void> {
  const startedAt = Date.now()
  const workflowId = config.workflowId?.trim() as WorkflowId | undefined
  if (!workflowId) throw new IntegrationError('workflowId is required: the Terros workflow these stages belong to')
  if (!Object.keys({ ...config.resultStages, ...config.jobStatusStages }).length) {
    throw new IntegrationError('Map at least one LeadPerfection status in resultStages or jobStatusStages')
  }
  const requestType = config.requestType?.trim().toLowerCase() || 'update'
  if (requestType !== 'update' && requestType !== 'upsert') {
    throw new IntegrationError(`requestType must be 'update' or 'upsert', got "${config.requestType}"`)
  }
  const lookbackDays = Number(config.lookbackDays || 2)
  if (!(lookbackDays > 0)) throw new IntegrationError(`lookbackDays must be a positive number of days`)
  const zone = config.timeZone?.trim() || 'utc'
  const today = DateTime.fromMillis(now, { zone })
  if (!today.isValid) throw new IntegrationError(`timeZone "${config.timeZone}" is not an IANA time zone`)

  const start = toLeadPerfectionDate(today.minus({ days: lookbackDays }))
  const end = toLeadPerfectionDate(today)
  const appointments = await leadPerfection.getSalesAppointments(start, end)
  const jobs = await leadPerfection.getJobStatusChanges(
    start,
    toLeadPerfectionDate(today.plus({ days: 1 })),
    LIMITS.jobPageSize,
    LIMITS.jobPages
  )
  if (!jobs.complete) {
    console.log(`Read the newest ${jobs.rows.length} job status changes; older ones in the window are not read`)
  }

  const customers = collectCustomers(appointments, jobs.rows)
  console.log(`LeadPerfection ${start}-${end}: ${customers.length} customers with appointment results or job changes`)

  const lookups = { remaining: LIMITS.leadLookups }
  let failed = 0
  for (const customer of rotate(customers, now)) {
    if (Date.now() - startedAt > LIMITS.runMs) {
      console.log('Out of run time; the remaining customers wait for the next run')
      break
    }
    const target = findTarget(customer, config)
    if (!target) {
      console.log(
        `Leaving LeadPerfection customer ${customer.cstId} alone: neither result "${customer.result ?? ''}" ` +
          `nor job status "${customer.jobStatus ?? ''}" is mapped`
      )
      continue
    }
    try {
      await syncCustomer(customer, target, { workflowId, requestType, zone, lookups }, leadPerfection, terros)
    } catch (error) {
      if (error instanceof IntegrationError) throw error
      failed++
      console.error(`Failed to sync LeadPerfection customer ${customer.cstId}`, error)
    }
  }
  if (failed > 0) throw new Error(`${failed} LeadPerfection customers failed to sync; the next run retries them`)
}

// A customer no account matches costs a GetLead call on every run. Starting each run at a different customer keeps
// a window with more of them than one run's lookups from starving the customers after them.
function rotate<T>(items: T[], now: number): T[] {
  const offset = items.length ? Math.floor(now / 60_000) % items.length : 0
  return [...items.slice(offset), ...items.slice(0, offset)]
}

// Groups both feeds by LeadPerfection customer, keeping each customer's latest appointment and latest job status.
export function collectCustomers(appointments: SalesAppointment[], jobs: JobStatusChange[]): Customer[] {
  const customers = new Map<string, Customer>()
  const customer = (cstId: string) => {
    const existing = customers.get(cstId)
    if (existing) return existing
    const created: Customer = { cstId }
    customers.set(cstId, created)
    return created
  }

  // Pages come oldest first, so a customer's row on a later page is newer. Within a page LeadPerfection orders rows
  // by job ID, so of two jobs of one customer on the same page, the later job's status wins.
  for (const job of jobs) {
    if (!job.cst_id) continue
    Object.assign(customer(String(job.cst_id).trim()), {
      jobStatus: clean(job.jobstatus),
      contractDate: clean(job.contractdate),
      result: clean(job.disposition),
      apptDate: clean(job.apptdate),
      entryDate: clean(job.entrydate),
      ...defined({
        firstName: clean(job.firstname),
        lastName: clean(job.lastname),
        email: clean(job.email),
        phone: clean(job.phone1),
        line1: clean(job.address1),
        city: clean(job.city),
        state: clean(job.state),
        zip: clean(job.zip),
      }),
    })
  }

  // An issued appointment's own result is more specific than the job row's lead disposition, and the latest
  // appointment of a customer wins.
  const latest = new Map<string, SalesAppointment>()
  for (const appointment of appointments) {
    const cstId = String(appointment.Cst_ID ?? '').trim()
    if (!cstId || cstId === '0') continue
    const previous = latest.get(cstId)
    if (!previous || (appointment.ApptDate ?? '') >= (previous.ApptDate ?? '')) latest.set(cstId, appointment)
  }
  for (const [cstId, appointment] of latest) {
    const target = customer(cstId)
    Object.assign(target, {
      result: clean(appointment.Disposition) ?? target.result,
      apptDate: clean(appointment.ApptDate) ?? target.apptDate,
      firstName: target.firstName ?? clean(appointment.firstname),
      lastName: target.lastName ?? clean(appointment.lastname),
      email: target.email ?? clean(appointment.email),
      phone: target.phone ?? clean(appointment.Phone),
      line1: target.line1 ?? clean(appointment.Address1),
      city: target.city ?? clean(appointment.City),
      state: target.state ?? clean(appointment.State),
      zip: target.zip ?? clean(appointment.zip),
    })
  }

  return [...customers.values()]
}

// The appointment result first, then the job status, so a mapped job status (an installed job) moves the account
// past the result's stage (Sale). The date is when the winning status happened: the entry date for Set, the
// appointment date for other results, and the contract date for a job status.
export function findTarget(customer: Customer, config: Pick<SyncConfig, 'resultStages' | 'jobStatusStages'>) {
  const steps: Target[] = []
  const resultStage = lookup(config.resultStages, customer.result)
  if (resultStage && customer.result) {
    const date = customer.result.toLowerCase() === 'set' ? (customer.entryDate ?? customer.apptDate) : customer.apptDate
    steps.push({ stageId: resultStage, sourceStatus: customer.result, date })
  }
  const jobStage = lookup(config.jobStatusStages, customer.jobStatus)
  if (jobStage && customer.jobStatus) {
    steps.push({ stageId: jobStage, sourceStatus: customer.jobStatus, date: customer.contractDate })
  }
  return steps.at(-1)
}

type SyncContext = {
  workflowId: WorkflowId
  requestType: 'update' | 'upsert'
  zone: string
  lookups: { remaining: number }
}

async function syncCustomer(
  customer: Customer,
  target: Target,
  context: SyncContext,
  leadPerfection: LeadPerfection,
  terros: Terros
): Promise<void> {
  const { workflowId, zone } = context
  const lastActionDate = fromLeadPerfectionDate(target.date, zone) ?? Date.now()
  const stage = { workflowId, workflowTarget: target.stageId, sourceStatus: target.sourceStatus, lastActionDate }

  const match = await findAccount(customer, context, leadPerfection, terros)
  if (match === 'deferred') {
    console.log(`LeadPerfection customer ${customer.cstId} waits for the next run: out of lead lookups`)
    return
  }

  if (match) {
    const { account: matched, leadId } = match
    const inStage = matched.workflowId === workflowId && matched.workflowStageId === target.stageId
    const link = defined({
      // Links the customer for later runs without a GetLead call. One set by another system is kept.
      sourceId: matched.sourceId ? undefined : toSourceId(customer.cstId),
      // Moving the account fires Send, which skips an account with an externalLeadId: without one, a move into a
      // send stage would add the customer to LeadPerfection a second time.
      externalLeadId: matched.externalLeadId ? undefined : (leadId ?? toSourceId(customer.cstId)),
    })
    if (inStage && !Object.keys(link).length) {
      console.log(`Account ${matched.accountId} is already in stage ${target.stageId}`)
      return
    }
    await terros.account.upsert({
      requestType: 'update',
      account: { accountId: matched.accountId, ...(inStage ? {} : stage), ...link },
    })
    console.log(
      `Account ${matched.accountId}: ${inStage ? 'linked to' : `moved to ${target.stageId} by`} ` +
        `LeadPerfection customer ${customer.cstId} (${target.sourceStatus})`
    )
    return
  }

  if (context.requestType !== 'upsert') {
    console.log(`Skipping LeadPerfection customer ${customer.cstId}: no Terros account matches it`)
    return
  }
  const result = await terros.account.upsert({
    requestType: 'upsert',
    account: {
      ...stage,
      sourceId: toSourceId(customer.cstId),
      externalLeadId: toSourceId(customer.cstId),
      accountSource: LEADPERFECTION_SOURCE,
      resident: defined({
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      }),
      location: defined({
        line1: customer.line1,
        locality: customer.city,
        countrySubd: customer.state,
        postal1: customer.zip,
      }),
    },
  })
  console.log(`Account ${result.account?.accountId} created from LeadPerfection customer ${customer.cstId}`)
}

// account/match finds a sourceId among every system's accounts in the company, and other systems use plain numbers
// too, so the customer ID alone could name another system's account.
function toSourceId(cstId: string): string {
  return `leadperfection:${cstId}`
}

// The matched account, with the customer's inbound lead ID when GetLead returned one.
type Match = { account: AccountData; leadId?: string }

// Match order: an account an earlier run linked (sourceId), then the lognumber Send put on the lead (the Terros
// account ID), then the inbound lead ID Send saved as externalLeadId, then the phone number. Never the name.
async function findAccount(
  customer: Customer,
  context: SyncContext,
  leadPerfection: LeadPerfection,
  terros: Terros
): Promise<Match | undefined | 'deferred'> {
  const linked = await terros.account.match({ sourceId: toSourceId(customer.cstId) })
  if (linked.account) return { account: linked.account }

  // Neither feed carries lognumber or the inbound lead ID; only GetLead does, one customer per call.
  if (context.lookups.remaining <= 0) return 'deferred'
  context.lookups.remaining--
  const leads = await leadPerfection.getLeadLinks(customer.cstId)
  const leadIds = leads.map((lead) => clean(lead.in1_id)).filter((id) => id !== undefined)

  for (const lead of leads) {
    const accountId = toAccountId(lead)
    const account = accountId && (await terros.account.match({ accountId })).account
    if (account) return { account, leadId: clean(lead.in1_id) }
  }
  for (const externalLeadId of leadIds) {
    const { account } = await terros.account.match({ externalLeadId })
    if (account) return { account }
  }
  const account = await findByPhone(customer, terros)
  return account && { account, leadId: leadIds[0] }
}

// Terros cannot search accounts by phone, so this lists the accounts at the customer's ZIP code and compares
// phone digits. More than one match is ambiguous and matches nothing.
async function findByPhone(customer: Customer, terros: Terros): Promise<AccountData | undefined> {
  const phone = phoneDigits(customer.phone)
  const zip = toZip(customer.zip)
  if (!phone || !zip) return undefined
  const { accounts } = await terros.account.list({ searchInput: { zipCodes: [zip] }, size: 1000 })
  const matches = accounts.filter((account) => phoneDigits(account.resident?.phone) === phone)
  if (matches.length > 1) {
    console.log(`LeadPerfection customer ${customer.cstId}: ${matches.length} accounts share its phone; none matched`)
    return undefined
  }
  return matches[0]
}

function toAccountId(lead: LeadLink): AccountId | undefined {
  const lognumber = clean(lead.lognumber)
  return lognumber && /^Account[.:]/.test(lognumber) ? (lognumber as AccountId) : undefined
}

// The last ten digits, so (555)555-0103, 5555550103 and +1 555 555 0103 compare equal.
export function phoneDigits(value: unknown): string | undefined {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : ''
  return digits.length >= 10 ? digits.slice(-10) : undefined
}

// Keys are matched without case or padding, since LeadPerfection pads some codes with spaces.
function lookup(mapping: Record<string, string> | undefined, value: string | undefined): string | undefined {
  if (!mapping || !value) return undefined
  const key = value.trim().toLowerCase()
  const found = Object.entries(mapping).find(([name]) => name.trim().toLowerCase() === key)
  return found?.[1]?.trim() || undefined
}

function clean(value: unknown): string | undefined {
  const text = value === undefined || value === null ? '' : String(value).trim()
  return text || undefined
}

function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>
}
