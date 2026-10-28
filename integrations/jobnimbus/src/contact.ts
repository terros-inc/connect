import type { AccountWebhookData } from '@terros-inc/sdk'
import {
  findMissingRequiredFields,
  type JobNimbusClient,
  JobNimbusError,
  type JobNimbusScriptConfig,
  toJobNimbusRecord,
} from './jobnimbus.ts'

type PrimaryContactInput = {
  account: AccountWebhookData
  salesRepId: string
  scriptConfig: JobNimbusScriptConfig
}

export function shouldSyncContact(account: AccountWebhookData, scriptConfig: JobNimbusScriptConfig): boolean {
  if (!scriptConfig.contactType || !scriptConfig.contactStatus) return false

  const resident = account.resident
  const hasName = Boolean(String(resident?.firstName ?? '').trim() || String(resident?.lastName ?? '').trim())
  return hasName && findMissingRequiredFields(account, scriptConfig.requiredFields).length === 0
}

export function toNewJobNimbusContact(
  contact: Record<string, unknown>,
  scriptConfig: JobNimbusScriptConfig
): Record<string, unknown> {
  return { ...contact, record_type_name: scriptConfig.contactType, status_name: scriptConfig.contactStatus }
}

export function linkPrimaryContact(
  job: Record<string, unknown>,
  contactId: string | undefined
): Record<string, unknown> {
  if (!contactId) return job
  return { ...job, primary: { id: contactId } }
}

// A job has no phone or email, so they go on the job's primary contact. Like jobs, the contact is found again by
// the account ID in its external_id, so a retry or a later change updates it instead of creating another. A contact
// JobNimbus rejects is logged and the job still syncs without it; the next send tries the contact again.
export async function syncPrimaryContact(
  jobNimbus: JobNimbusClient,
  input: PrimaryContactInput
): Promise<string | undefined> {
  if (!shouldSyncContact(input.account, input.scriptConfig)) return undefined

  try {
    return await upsertContact(jobNimbus, input)
  } catch (error) {
    if (!(error instanceof JobNimbusError)) throw error
    console.log(`Skipping JobNimbus contact for account ${input.account.id}: ${error.message}`)
    return undefined
  }
}

async function upsertContact(
  jobNimbus: JobNimbusClient,
  { account, salesRepId, scriptConfig }: PrimaryContactInput
): Promise<string | undefined> {
  const contact = toJobNimbusRecord(account, salesRepId, scriptConfig, 'contact')
  const existing = await jobNimbus.findByExternalId('contacts', account.id)
  if (existing?.jnid) {
    await jobNimbus.update('contacts', existing.jnid, contact)
    console.log(`Updated JobNimbus contact ${existing.jnid} for account ${account.id}`)
    return existing.jnid
  }

  const created = await jobNimbus.create('contacts', toNewJobNimbusContact(contact, scriptConfig))
  if (!created?.jnid) throw Error('Failed to detect jnid from JobNimbus contact response')
  console.log(`Created JobNimbus contact ${created.jnid} for account ${account.id}`)
  return created.jnid
}
