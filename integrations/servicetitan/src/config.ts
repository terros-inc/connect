import type { CustomFieldId } from '@terros-inc/sdk'
import { PermanentError } from './errors.ts'

const numericFields = [
  'jobTypeId',
  'cancelReasonId',
  'customFieldCustomerId',
  'customFieldLocationId',
  'customFieldSetter',
  'customFieldAppointmentOutcome',
  'campaignIdSetterGen',
  'campaignIdCloserGen',
  'campaignIdUnknown',
] as const
type NumericField = (typeof numericFields)[number]
export type Config = Partial<Record<NumericField, number>> & {
  jobTypeId: number
  cancelReasonId: number
  serviceTitanJobId: CustomFieldId
  teamToBusinessUnitMap: Record<string, number>
}
export type RawConfig = Record<string, string | Record<string, string>>
export type Secrets = { appKey: string; clientId: string; clientSecret: string; tenantId: string }

function positiveId(value: unknown, field: string): number {
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value.trim()) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  ) {
    throw new PermanentError(`${field} must be a positive integer numeric ServiceTitan ID`)
  }
  return Number(value)
}

export function parseConfig(raw: RawConfig): Config {
  const numbers: Partial<Record<NumericField, number>> = {}
  for (const field of numericFields) {
    const value = raw[field]
    const required = field === 'jobTypeId' || field === 'cancelReasonId'
    if (!required && (value === undefined || value === '')) continue
    numbers[field] = positiveId(value, field)
  }
  const cf = raw.serviceTitanJobId
  if (typeof cf !== 'string' || !/^CF\.[A-Za-z0-9_-]+$/.test(cf.trim())) {
    throw new PermanentError('serviceTitanJobId is required and must be a Terros account custom field ID (CF.*)')
  }
  const mapping = raw.teamToBusinessUnitMap
  if (mapping !== undefined && (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping))) {
    throw new PermanentError('teamToBusinessUnitMap must be a mapping')
  }
  return {
    ...numbers,
    jobTypeId: numbers.jobTypeId!,
    cancelReasonId: numbers.cancelReasonId!,
    serviceTitanJobId: cf.trim() as CustomFieldId,
    teamToBusinessUnitMap: Object.fromEntries(
      Object.entries(mapping ?? {}).map(([team, id]) => [team, positiveId(id, `teamToBusinessUnitMap.${team}`)])
    ),
  }
}

export function parseSecrets(raw: Record<string, string>): Secrets {
  for (const field of ['appKey', 'clientId', 'clientSecret', 'tenantId']) {
    if (!raw[field]?.trim()) throw new PermanentError(`Missing ServiceTitan secret: ${field}`)
  }
  positiveId(raw.tenantId, 'tenantId')
  return {
    appKey: raw.appKey!,
    clientId: raw.clientId!,
    clientSecret: raw.clientSecret!,
    tenantId: raw.tenantId!.trim(),
  }
}
