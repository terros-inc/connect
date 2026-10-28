import type { AccountId, CalendarEventId, CustomFieldId, CustomFieldMap, SmallAddress } from '@terros-inc/sdk'
import {
  CREATE_RESERVE_MS,
  type Contact,
  type CustomField,
  type Job,
  type Result,
  type ServiceTitanClient,
  type Technician,
} from './servicetitan.ts'
import { PermanentError } from './errors.ts'
import type { Config } from './config.ts'
import { toState, toZip } from './address.ts'

type User = {
  firstName?: string
  lastName?: string
  preferredName?: string
  clientUserId?: string
  closerStatus?: string
}
export type EventData = {
  id: CalendarEventId
  eventType: string
  eventDate: string
  duration: number
  status?: string
  sourceId?: string
  owner?: User
  attendee?: User
  account?: { accountId: AccountId }
}
export type CalendarEventWebhook =
  | { entity: 'Event'; action: 'add' | 'update'; data: EventData }
  | { entity: 'Event'; action: 'remove'; data: { id: CalendarEventId; sourceId?: string } }
export type Account = {
  accountId: AccountId
  accountSource?: string
  customFields?: CustomFieldMap
  location?: Omit<SmallAddress, 'latlng'> & { latlng?: SmallAddress['latlng'] }
  resident?: Record<string, unknown>
}
export type Ports = {
  readAccount: (id: AccountId) => Promise<Account>
  writeAccountCustomField: (id: AccountId, fieldId: CustomFieldId, value: string) => Promise<void>
  writeEventSourceId: (id: CalendarEventId, sourceId: string) => Promise<void>
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}
export type Outcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'created'; jobId: number }
  | { kind: 'reassigned'; oldJobId: number; jobId: number; oldJobCancelled: boolean }
  | { kind: 'updated'; changes: string[] }
  | { kind: 'unchanged' }

function eventSkipReason(event: EventData): string | undefined {
  if (event.eventType !== 'Consultation') return 'non-Consultation event'
  if (!event.attendee) return 'missing attendee'
  if (!event.owner) return 'missing owner'
  if (!event.account) return 'missing account'
}
export function skipReason(payload: CalendarEventWebhook): string | undefined {
  if (payload.action === 'remove') return 'removed event'
  return eventSkipReason(payload.data)
}

export type JobLink =
  | { kind: 'none' }
  | { kind: 'job'; jobId: number }
  | { kind: 'otherTenant' }
  | { kind: 'invalid'; value: string }

// Links are stored as `tenantId:jobId`. Bare numeric job IDs are legacy account-field links and are read as this
// tenant's only when allowBare is set; legacy never wrote event.sourceId, so a bare sourceId belongs to something else.
export function parseJobLink(value: unknown, tenantId: string, allowBare = true): JobLink {
  if (value === undefined || value === null) return { kind: 'none' }
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : JSON.stringify(value)
  if (!text) return { kind: 'none' }
  const match = /^(?:(\d+):)?(\d+)$/.exec(text)
  const jobId = Number(match?.[2])
  if (!match || !Number.isSafeInteger(jobId) || jobId <= 0) return { kind: 'invalid', value: text }
  if (match[1] === undefined && !allowBare) return { kind: 'none' }
  if (match[1] !== undefined && match[1] !== tenantId) return { kind: 'otherTenant' }
  return { kind: 'job', jobId }
}
export function formatJobLink(tenantId: string, jobId: number): string {
  return `${tenantId}:${jobId}`
}

function getName(user: User): string {
  return `${user.preferredName?.trim() || user.firstName?.trim() || '?'} ${user.lastName || '?'}`.trim()
}
export function determineCampaignId(status: string | undefined, config: Config): number {
  if (status === 'Needs_Help' && config.campaignIdSetterGen !== undefined) return config.campaignIdSetterGen
  if (config.campaignIdCloserGen !== undefined) return config.campaignIdCloserGen
  if (config.campaignIdUnknown !== undefined) return config.campaignIdUnknown
  throw new PermanentError('No campaignId configured for ServiceTitan integration')
}
function jobFields(event: EventData, config: Config): CustomField[] {
  const fields: CustomField[] = []
  if (config.customFieldSetter) fields.push({ typeId: config.customFieldSetter, value: getName(event.owner!) })
  if (config.customFieldAppointmentOutcome && event.status)
    fields.push({ typeId: config.customFieldAppointmentOutcome, value: event.status })
  return fields
}
export function shouldUpdateJob(job: Job, event: EventData, config: Config): boolean {
  if (job.campaignId !== determineCampaignId(event.owner!.closerStatus, config)) return true
  if (
    config.customFieldAppointmentOutcome &&
    event.status &&
    job.customFields?.find((cf) => cf.typeId === config.customFieldAppointmentOutcome)?.value !== event.status
  )
    return true
  if (config.customFieldSetter) {
    const value = job.customFields?.find((cf) => cf.typeId === config.customFieldSetter)?.value
    const normalize = (text: string) => text.toLowerCase().replaceAll(' ', '').trim()
    if (!value || normalize(value) !== normalize(getName(event.owner!))) return true
  }
  return false
}
function times(event: EventData) {
  const start = new Date(event.eventDate)
  return { start: start.toISOString(), end: new Date(start.getTime() + event.duration * 60_000).toISOString() }
}
// A non-retryable failure (4xx, invalid response) is permanent; retryable ones (429, 5xx, network, budget) are not.
function checked<T>(result: Result<T>): T {
  if (!result.ok) throw result.retryable ? new Error(result.message) : new PermanentError(result.message)
  return result.value
}
// Any create failure is permanent: a timed-out or 5xx create may have succeeded, so redelivering it could duplicate.
function checkedCreate<T>(result: Result<T>): T {
  if (!result.ok) throw new PermanentError(`${result.message}; not retried because the create may have succeeded`)
  return result.value
}
type Skip = { skip: string }
function createBudgetSkip(api: ServiceTitanClient): Skip | undefined {
  const remaining = api.budget.remaining()
  if (remaining < CREATE_RESERVE_MS) {
    return { skip: `run budget too low to start a ServiceTitan create (${Math.round(remaining / 1000)}s left)` }
  }
}

async function findOrCreateCustomer(
  api: ServiceTitanClient,
  account: Account,
  config: Config,
  ports: Ports
): Promise<{ customerId: number; locationId: number } | Skip> {
  const resident = account.resident
  const location = account.location!
  if (!resident || !Object.keys(resident).length) return { skip: 'missing resident' }
  const text = (key: string) => (typeof resident[key] === 'string' ? (resident[key] as string) : '')
  const name =
    text('businessName') ||
    (text('firstName') || text('lastName') ? `${text('firstName')} ${text('lastName')}`.trim() : text('name'))
  const address = {
    street: location.line1,
    city: location.locality,
    state: toState(location.countrySubd),
    zip: toZip(location.postal1),
    country: 'USA' as const,
    ...(location.latlng ? { latitude: location.latlng.latitude, longitude: location.latlng.longitude } : {}),
  }
  if (config.customFieldCustomerId) {
    const result = checked(
      await api.searchCustomers({
        name,
        street: address.street,
        city: address.city,
        state: address.state,
        zip: address.zip,
      })
    )
    const match = result.data.find(
      (customer) =>
        customer.customFields?.find((cf) => cf.typeId === config.customFieldCustomerId)?.value === account.accountId
    )
    if (match) return { customerId: match.id, locationId: checked(await api.getLocation(match.id)).id }
  }
  const contacts: Contact[] = []
  if (text('email')) contacts.push({ type: 'Email' as const, value: text('email'), memo: 'email' })
  if (text('phone')) contacts.push({ type: 'Phone' as const, value: text('phone'), memo: 'phone' })
  const fields = (id?: number) => (id ? [{ typeId: id, value: account.accountId }] : undefined)
  const budgetSkip = createBudgetSkip(api)
  if (budgetSkip) return budgetSkip
  // Not retried: a create that timed out may have succeeded.
  const customer = checkedCreate(
    await api.createCustomer({
      name,
      type: 'Residential',
      address,
      contacts,
      customFields: fields(config.customFieldCustomerId),
      locations: [{ name, address, contacts, customFields: fields(config.customFieldLocationId) }],
    })
  )
  ports.log('info', `ServiceTitan customer created: ${customer.id}`)
  return { customerId: customer.id, locationId: checked(await api.getLocation(customer.id)).id }
}

async function createJob(
  api: ServiceTitanClient,
  customer: { customerId: number; locationId: number },
  event: EventData,
  config: Config,
  technician: Technician,
  ports: Ports
): Promise<{ id: number } | Skip> {
  const businessUnitId =
    (technician.team ? config.teamToBusinessUnitMap[technician.team] : undefined) ?? technician.businessUnitId
  if (!businessUnitId) throw new PermanentError('BusinessUnitId is required to create ServiceTitan job')
  const budgetSkip = createBudgetSkip(api)
  if (budgetSkip) return budgetSkip
  // Not retried: a create that timed out may have succeeded.
  const created = checkedCreate(
    await api.createJob({
      customerId: customer.customerId,
      locationId: customer.locationId,
      jobTypeId: config.jobTypeId,
      priority: 'Normal',
      businessUnitId,
      campaignId: determineCampaignId(event.owner!.closerStatus, config),
      customFields: jobFields(event, config),
      appointments: [{ ...times(event), technicianIds: [technician.id] }],
    })
  )
  // Logged before linking, so a job whose link write fails can still be found.
  ports.log('info', `ServiceTitan job created: ${created.id}`)
  return created
}

// `skipped` is for business rules and a run budget too low to create. Permanent failures throw PermanentError and
// other failures throw Error; the entrypoint logs both. Sales does not retry a script that throws, so either way the
// event is not synced until it changes again. Compare-before-write keeps any later run from repeating writes.
export async function sync(
  payload: CalendarEventWebhook,
  config: Config,
  api: ServiceTitanClient,
  ports: Ports
): Promise<Outcome> {
  if (payload.action === 'remove') return { kind: 'skipped', reason: 'removed event' }
  const event = payload.data
  const reason = eventSkipReason(event)
  if (reason) return { kind: 'skipped', reason }
  const account = await ports.readAccount(event.account!.accountId)
  if (account.accountSource !== 'Terros') return { kind: 'skipped', reason: 'account source is not Terros' }
  if (!account.location) throw new PermanentError('Account has no location')

  const tenantId = api.tenantId
  let linked: number | undefined
  const stored = parseJobLink(account.customFields?.[config.serviceTitanJobId], tenantId)
  if (stored.kind === 'invalid') {
    throw new PermanentError(
      `Invalid ServiceTitan job link "${stored.value}" in account field ${config.serviceTitanJobId}`
    )
  }
  if (stored.kind === 'otherTenant') return { kind: 'skipped', reason: 'job linked to another ServiceTitan tenant' }
  if (stored.kind === 'job') linked = stored.jobId
  else {
    // An empty field may be hidden from or inactive for this token; the event keeps its own copy of the link. Only
    // the tenant-prefixed form this script writes is trusted; anything else in sourceId is ignored.
    const fromEvent = parseJobLink(event.sourceId, tenantId, false)
    if (fromEvent.kind === 'otherTenant')
      return { kind: 'skipped', reason: 'event linked to another ServiceTitan tenant' }
    if (fromEvent.kind === 'job') linked = fromEvent.jobId
  }

  const technicians = checked(
    await api.searchTechnicians({
      ids: event.attendee!.clientUserId ? [event.attendee!.clientUserId] : undefined,
      name: getName(event.attendee!),
    })
  )
  const technician = technicians.data[0]
  if (!technician) return { kind: 'skipped', reason: 'no matching technician' }

  const changes: string[] = []
  const link = async (jobId: number) => {
    const value = formatJobLink(tenantId, jobId)
    if (account.customFields?.[config.serviceTitanJobId] !== value) {
      await ports.writeAccountCustomField(account.accountId, config.serviceTitanJobId, value)
      changes.push('account custom field')
    }
    if (event.sourceId !== value) {
      await ports.writeEventSourceId(event.id, value)
      changes.push('event sourceId')
    }
  }

  if (linked !== undefined) {
    const job = checked(await api.getJob(linked))
    let active: { technicianId: number } | undefined
    if (job.lastAppointmentId) {
      const assignments = await api.searchAppointmentAssignments([job.lastAppointmentId])
      // As in legacy, a failed lookup skips only the reassignment check; the job and appointment still update.
      if (assignments.ok) active = assignments.value.data.find((assignment) => assignment.active)
      else ports.log('warn', `ServiceTitan reassignment check skipped for job ${job.id}: ${assignments.message}`)
    }
    if (active && active.technicianId !== technician.id) {
      // Link the replacement before cancelling, so no later run creates another replacement.
      const created = await createJob(api, job, event, config, technician, ports)
      if ('skip' in created) return { kind: 'skipped', reason: created.skip }
      await link(created.id)
      const cancel = await api.cancelJob(job.id, {
        reasonId: config.cancelReasonId,
        memo: 'Closer reassigned via automation',
      })
      if (!cancel.ok) {
        // Nothing retries this: the links already point at the replacement. The marker is fixed so it can be
        // searched and alerted on; the old job must be cancelled by hand.
        ports.log(
          'error',
          `SERVICETITAN_ABANDONED_CANCEL tenant=${tenantId} oldJob=${job.id} newJob=${created.id}: ${cancel.message}`
        )
      }
      return { kind: 'reassigned', oldJobId: job.id, jobId: created.id, oldJobCancelled: cancel.ok }
    }
    if (shouldUpdateJob(job, event, config)) {
      checked(
        await api.updateJob(job.id, {
          campaignId: determineCampaignId(event.owner!.closerStatus, config),
          customFields: jobFields(event, config),
        })
      )
      changes.push('job')
    }
    if (job.lastAppointmentId) {
      const appointment = checked(await api.getAppointment(job.lastAppointmentId))
      const desired = times(event)
      if (
        Date.parse(appointment.start) !== Date.parse(desired.start) ||
        Date.parse(appointment.end) !== Date.parse(desired.end)
      ) {
        checked(await api.updateAppointment(appointment.id, desired))
        changes.push('appointment')
      }
    }
    await link(job.id)
    return changes.length ? { kind: 'updated', changes } : { kind: 'unchanged' }
  }
  const customer = await findOrCreateCustomer(api, account, config, ports)
  if ('skip' in customer) return { kind: 'skipped', reason: customer.skip }
  const created = await createJob(api, customer, event, config, technician, ports)
  if ('skip' in created) return { kind: 'skipped', reason: created.skip }
  await link(created.id)
  return { kind: 'created', jobId: created.id }
}
