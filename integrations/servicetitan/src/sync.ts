import type { AccountId, CalendarEventId, CustomFieldMap, SmallAddress } from '@terros-inc/sdk'
import {
  retryWithBackoff,
  type CustomField,
  type Contact,
  type Job,
  type ServiceTitanClient,
  type Technician,
  type Result,
} from './servicetitan.ts'
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

export function skipReason(payload: CalendarEventWebhook): string | undefined {
  if (payload.action === 'remove') return 'removed event'
  if (payload.data.eventType !== 'Consultation') return 'non-Consultation event'
  if (!payload.data.attendee) return 'missing attendee'
  if (!payload.data.owner) return 'missing owner'
  if (!payload.data.account) return 'missing account'
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
  if (config.customFieldAppointmentOutcome)
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

async function findOrCreateCustomer(api: ServiceTitanClient, account: Account, config: Config) {
  const resident = account.resident
  const location = account.location!
  if (!resident || !Object.keys(resident).length) throw new Error('Missing resident')
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
    const result = await api.searchCustomers({
      name,
      street: address.street,
      city: address.city,
      state: address.state,
      zip: address.zip,
    })
    const match = result.ok
      ? result.value.data.find(
          (customer) =>
            customer.customFields?.find((cf) => cf.typeId === config.customFieldCustomerId)?.value === account.accountId
        )
      : undefined
    if (match) {
      const found = await retryWithBackoff(() => api.getLocation(match.id), 3000)
      return { customerId: match.id, locationId: found.id }
    }
  }
  const contacts: Contact[] = []
  if (text('email')) contacts.push({ type: 'Email' as const, value: text('email'), memo: 'email' })
  if (text('phone')) contacts.push({ type: 'Phone' as const, value: text('phone'), memo: 'phone' })
  const fields = (id?: number) => (id ? [{ typeId: id, value: account.accountId }] : undefined)
  const customer = checked(
    await retryWithBackoff(
      () =>
        api.createCustomer({
          name,
          type: 'Residential',
          address,
          contacts,
          customFields: fields(config.customFieldCustomerId),
          locations: [{ name, address, contacts, customFields: fields(config.customFieldLocationId) }],
        }),
      5000
    )
  )
  const found = await retryWithBackoff(() => api.getLocation(customer.id), 3000)
  return { customerId: customer.id, locationId: found.id }
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
  return checked(
    await retryWithBackoff(
      () =>
        api.createJob({
          customerId: customer.customerId,
          locationId: customer.locationId,
          jobTypeId: config.jobTypeId,
          priority: 'Normal',
          businessUnitId,
          campaignId: determineCampaignId(event.owner!.closerStatus, config),
          customFields: jobFields(event, config),
          appointments: [{ ...times(event), technicianIds: [technician.id] }],
        }),
      5000
    )
  )
}

export async function sync(
  payload: CalendarEventWebhook,
  config: Config,
  api: ServiceTitanClient,
  ports: Ports
): Promise<Outcome> {
  const reason = skipReason(payload)
  if (reason) return { kind: 'skipped', reason }
  if (payload.action === 'remove') return { kind: 'skipped', reason: 'removed event' }
  const event = payload.data
  const account = await ports.readAccount(event.account!.accountId)
  if (account.accountSource !== 'Terros') return { kind: 'skipped', reason: 'account source is not Terros' }
  if (!account.location) throw new Error('Account has no location')
  const technicians = await api.searchTechnicians({
    ids: event.attendee!.clientUserId ? [event.attendee!.clientUserId] : undefined,
    name: getName(event.attendee!),
  })
  const technician = technicians.ok ? technicians.value.data[0] : undefined
  if (!technician) return { kind: 'skipped', reason: 'no matching technician' }
  const changes: string[] = []
  const link = async (jobId: number) => {
    const value = String(jobId)
    if (account.customFields?.[config.serviceTitanJobId] !== value) {
      // Account update replaces the map; retain every existing field.
      await ports.writeAccountCustomField(account.accountId, {
        ...account.customFields,
        [config.serviceTitanJobId]: value,
      })
      changes.push('account custom field')
    }
    if (event.sourceId !== value) {
      await ports.writeEventSourceId(event.id, value)
      changes.push('event sourceId')
    }
  }
  const stored = account.customFields?.[config.serviceTitanJobId]
  const jobId = stored === undefined || stored === null || stored === '' ? undefined : Number(stored)
  if (jobId !== undefined && !Number.isNaN(jobId)) {
    const job = await api.getJob(jobId)
    const assignments = job.lastAppointmentId
      ? await api.searchAppointmentAssignments([job.lastAppointmentId])
      : undefined
    const active = assignments?.ok ? assignments.value.data.find((assignment) => assignment.active) : undefined
    if (active && active.technicianId !== technician.id) {
      const created = await createJob(api, job, event, config, technician)
      await link(created.id)
      const cancel = await retryWithBackoff(
        () =>
          api.cancelJob(job.id, {
            reasonId: config.cancelReasonId,
            memo: 'Closer reassigned via automation',
          }),
        5000
      )
      if (!cancel.ok) console.error('ServiceTitan previous job cancellation failed')
      return { kind: 'reassigned', oldJobId: job.id, jobId: created.id }
    }
    if (shouldUpdateJob(job, event, config)) {
      const result = await retryWithBackoff(
        () =>
          api.updateJob(job.id, {
            campaignId: determineCampaignId(event.owner!.closerStatus, config),
            customFields: jobFields(event, config),
          }),
        5000
      )
      if (result.ok) changes.push('job')
      else console.error('ServiceTitan job update failed')
    }
    if (job.lastAppointmentId) {
      const appointment = await api.getAppointment(job.lastAppointmentId)
      const desired = times(event)
      if (
        Date.parse(appointment.start) !== Date.parse(desired.start) ||
        Date.parse(appointment.end) !== Date.parse(desired.end)
      ) {
        const result = await retryWithBackoff(() => api.updateAppointment(appointment.id, desired), 5000)
        if (result.ok) changes.push('appointment')
        else console.error('ServiceTitan appointment update failed')
      }
    }
    await link(job.id)
    return changes.length ? { kind: 'updated', changes } : { kind: 'unchanged' }
  }
  let customer
  try {
    customer = await findOrCreateCustomer(api, account, config)
  } catch {
    console.error('ServiceTitan customer lookup or creation failed')
    return { kind: 'skipped', reason: 'customer lookup or creation failed' }
  }
  const created = await createJob(api, customer, event, config, technician)
  await link(created.id)
  return { kind: 'created', jobId: created.id }
}
