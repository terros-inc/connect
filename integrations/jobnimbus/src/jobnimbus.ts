import type { AccountWebhookData, LatLng } from '@terros-inc/sdk'
import { findFirstMappedValue, maskEmail, normalizeEmail, removeUndefinedValues } from './util.ts'

export type JobNimbusUser = { id: string; email?: string }
export type JobNimbusRecordResponse = { jnid?: string; [key: string]: unknown }

const baseUrl: string = 'https://app.jobnimbus.com/api1'

export async function getSalesRepId(owner: AccountWebhookData['owner'], apiKey: string): Promise<string | undefined> {
  if (!owner?.email) return undefined

  const users = await listJobNimbusUsers(apiKey)
  const salesRep = users?.find((user) => normalizeEmail(user.email) === normalizeEmail(owner.email))

  if (!salesRep) {
    console.log(`No JobNimbus user matched owner email ${maskEmail(owner.email)}`)
    return undefined
  }

  console.log(`Matched JobNimbus sales rep ${salesRep.id} by owner email ${maskEmail(owner.email)}`)
  return salesRep.id
}

export function toJobNimbusRecord(
  account: AccountWebhookData,
  salesRepId: string,
  scriptConfig: Record<string, string>,
  jobNimbusRecord: string
): Record<string, unknown> | undefined {
  if (jobNimbusRecord === 'contact') return toJobNimbusContact(account, salesRepId, scriptConfig)

  return toJobNimbusJob(account, salesRepId, scriptConfig)
}

function toJobNimbusContact(
  account: AccountWebhookData,
  salesRepId: string,
  scriptConfig: Record<string, string>
): Record<string, unknown> | undefined {
  const resident = (account.homeowner || {}) as Record<string, string | undefined>
  const address = account.location
  const firstName = resident.firstName || ''
  const lastName = resident.lastName || ''
  const statusName = getStatusName(account, scriptConfig)

  if (!statusName) return undefined

  return removeUndefinedValues({
    record_type_name: scriptConfig.workflowType || 'Customer',
    status_name: statusName,
    first_name: firstName,
    last_name: lastName,
    display_name: `${firstName} ${lastName}`.trim(),
    company: resident.businessName || scriptConfig.defaultCompanyName || '',
    email: resident.email,
    home_phone: resident.phone,
    address_line1: address?.line1,
    address_line2: address?.line2,
    city: address?.locality,
    state_text: address?.countrySubd,
    zip: address?.postal1,
    geo: toJobNimbusGeo(address?.latlng),
    sales_rep: salesRepId,
  })
}

function toJobNimbusJob(
  account: AccountWebhookData,
  salesRepId: string,
  scriptConfig: Record<string, string>
): Record<string, unknown> | undefined {
  const resident = (account.homeowner || {}) as Record<string, string | undefined>
  const address = account.location
  const firstName = resident.firstName || ''
  const lastName = resident.lastName || ''
  const displayName = `${firstName} ${lastName}`.trim()
  const statusName = getStatusName(account, scriptConfig)

  if (!statusName) return undefined

  return removeUndefinedValues({
    record_type_name: scriptConfig.workflowType || 'Customer',
    status_name: statusName,
    name: displayName || resident.businessName || `Terros Account ${account.id}`,
    description: account.notes?.[0]?.text,
    external_id: account.id,
    address_line1: address?.line1,
    address_line2: address?.line2,
    city: address?.locality,
    state_text: address?.countrySubd,
    zip: address?.postal1,
    geo: toJobNimbusGeo(address?.latlng),
    sales_rep: salesRepId,
  })
}

function getStatusName(account: AccountWebhookData, scriptConfig: Record<string, string>): string | undefined {
  const statusFields = (scriptConfig as { statusFields?: Record<string, string> }).statusFields || {}
  const statusValues = (scriptConfig as { statusValues?: Record<string, string> }).statusValues || {}
  const statusName = findFirstMappedValue(account as Record<string, unknown>, statusFields, statusValues)
  if (statusName) return statusName

  if (scriptConfig.defaultStatus) return scriptConfig.defaultStatus

  console.log(`Missing JobNimbus status for account ${account.id}`)
  return undefined
}

function toJobNimbusGeo(latlng: LatLng | undefined): { lat: number; lon: number } | undefined {
  if (!latlng) return undefined
  if (typeof latlng.latitude !== 'number' || typeof latlng.longitude !== 'number') return undefined

  return {
    lat: latlng.latitude,
    lon: latlng.longitude,
  }
}

export async function createJobNimbusRecord(
  apiKey: string,
  jobNimbusPath: string,
  record: Record<string, unknown>
): Promise<JobNimbusRecordResponse | undefined> {
  const response = await fetch(`${baseUrl}/${jobNimbusPath}`, {
    method: 'POST',
    headers: getJobNimbusHeaders(apiKey),
    body: JSON.stringify(record),
  })

  if (!response.ok) {
    const text = await response.text()
    console.log(`JobNimbus create failed: ${response.status} ${response.statusText} ${text}`)
    return undefined
  }

  return response.json() as Promise<JobNimbusRecordResponse>
}

export async function updateJobNimbusRecord(
  apiKey: string,
  jobNimbusPath: string,
  recordId: string,
  record: Record<string, unknown>
): Promise<JobNimbusRecordResponse | undefined> {
  const response = await fetch(`${baseUrl}/${jobNimbusPath}/${recordId}`, {
    method: 'PUT',
    headers: getJobNimbusHeaders(apiKey),
    body: JSON.stringify(record),
  })

  if (!response.ok) {
    const text = await response.text()
    console.log(`JobNimbus update failed: ${response.status} ${response.statusText} ${text}`)
    return undefined
  }

  return response.json() as Promise<JobNimbusRecordResponse>
}

async function listJobNimbusUsers(apiKey: string): Promise<JobNimbusUser[] | undefined> {
  const response = await fetch(`${baseUrl}/account/users`, {
    method: 'GET',
    headers: getJobNimbusHeaders(apiKey),
  })

  if (!response.ok) {
    const text = await response.text()
    console.log(`JobNimbus user list failed: ${response.status} ${response.statusText} ${text}`)
    return undefined
  }

  const data = (await response.json()) as { users?: JobNimbusUser[] }
  return data.users || []
}

function getJobNimbusHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}
