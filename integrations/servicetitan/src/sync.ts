import type { AccountId, CalendarEventId, CustomFieldMap, SmallAddress } from '@terros-inc/sdk'
import type { Contact, CustomField, Job, Result, ServiceTitanClient, Technician } from './servicetitan.ts'
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
  writeAccountCustomField: (id: AccountId, fields: CustomFieldMap) => Promise<void>
  writeEventSourceId: (id: CalendarEventId, sourceId: string) => Promise<void>
}
export type Outcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'created'; jobId: number }
  | { kind: 'reassigned'; oldJobId: number; jobId: number }
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

// Links are stored as `tenantId:jobId`; bare numeric job IDs written before tenant prefixes are read as this tenant's.
export function parseJobLink(value: unknown, tenantId: string): JobLink {
  if (value === undefined || value === null) return { kind: 'none' }
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : JSON.stringify(value)
  if (!text) return { kind: 'none' }
  const match = /^(?:(\d+):)?(\d+)$/.exec(text)
  const jobId = Number(match?.[2])
  if (!match || !Number.isSafeInteger(jobId) || jobId <= 0) return { kind: 'invalid', value: text }
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
  throw new Error('No campaignId configured for ServiceTitan integration')
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
function checked<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message)
  return result.value
}

async function findOrCreateCustomer(
  api: ServiceTitanClient,
  account: Account,
  config: Config
): Promise<{ customerId: number; locationId: number } | undefined> {
  const resident = account.resident
  const location = account.location!
  if (!resident || !Object.keys(resident).length) return undefined
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
  // Not retried: a create that timed out may have succeeded.
  const customer = checked(
    await api.createCustomer({
      name,
      type: 'Residential',
      address,
      contacts,
      customFields: fields(config.customFieldCustomerId),
      locations: [{ name, address, contacts, customFields: fields(config.customFieldLocationId) }],
    })
  )
  return { customerId: customer.id, locationId: checked(await api.getLocation(customer.id)).id }
}

async function createJob(
  api: ServiceTitanClient,
  customer: { customerId: number; locationId: number },
  event: EventData,
  config: Config,
  technician: Technician
) {
  const businessUnitId =
    (technician.team ? config.teamToBusinessUnitMap[technician.team] : undefined) ?? technician.businessUnitId
  if (!businessUnitId) throw new Error('BusinessUnitId is required to create ServiceTitan job')
  // Not retried: a create that timed out may have succeeded.
  return checked(
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
}

// ServiceTitan API failures throw so the run fails and is retried; compare-before-write keeps retries safe.
// `skipped` is only for business-rule skips and permanent input problems.
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
  if (!account.location) throw new Error('Account has no location')

  const tenantId = api.tenantId
  let linked: number | undefined
  const stored = parseJobLink(account.customFields?.[config.serviceTitanJobId], tenantId)
  if (stored.kind === 'invalid') {
    throw new Error(`Invalid ServiceTitan job link "${stored.value}" in account field ${config.serviceTitanJobId}`)
  }
  if (stored.kind === 'otherTenant') return { kind: 'skipped', reason: 'job linked to another ServiceTitan tenant' }
  if (stored.kind === 'job') linked = stored.jobId
  else {
    // An empty field may be hidden from or inactive for this token; the event keeps its own copy of the link.
    const fromEvent = parseJobLink(event.sourceId, tenantId)
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
    // TODO: switch to a sales partial custom-field update endpoint once one exists. account.update replaces the
    // whole map, so this re-reads right before writing and changes only the job link key; fields the token
    // cannot view are still dropped. GoHighLevel src/outgoing.ts (saveOpportunityId) needs the same endpoint.
    const fresh = await ports.readAccount(account.accountId)
    if (fresh.customFields?.[config.serviceTitanJobId] !== value) {
      await ports.writeAccountCustomField(account.accountId, {
        ...fresh.customFields,
        [config.serviceTitanJobId]: value,
      })
      changes.push('account custom field')
    }
    if (event.sourceId !== value) {
      await ports.writeEventSourceId(event.id, value)
      changes.push('event sourceId')
    }
  }

  if (linked !== undefined) {
    const job = checked(await api.getJob(linked))
    const assignments = job.lastAppointmentId
      ? checked(await api.searchAppointmentAssignments([job.lastAppointmentId]))
      : undefined
    const active = assignments?.data.find((assignment) => assignment.active)
    if (active && active.technicianId !== technician.id) {
      // Link the replacement before cancelling: a retry then follows the new link instead of creating another job.
      const created = await createJob(api, job, event, config, technician)
      await link(created.id)
      const cancel = await api.cancelJob(job.id, {
        reasonId: config.cancelReasonId,
        memo: 'Closer reassigned via automation',
      })
      if (!cancel.ok) {
        throw new Error(
          `Reassigned to ServiceTitan job ${created.id}, but cancelling previous job ${job.id} failed: ${cancel.message}`
        )
      }
      return { kind: 'reassigned', oldJobId: job.id, jobId: created.id }
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
  const customer = await findOrCreateCustomer(api, account, config)
  if (!customer) return { kind: 'skipped', reason: 'missing resident' }
  const created = await createJob(api, customer, event, config, technician)
  await link(created.id)
  return { kind: 'created', jobId: created.id }
}
