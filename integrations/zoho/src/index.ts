import { type AccountUpsertInput, type WorkflowId, wrapConnectHandler } from '@terros-inc/sdk'

type ZohoLeadPayload = {
  data: Record<string, any>
}

type ZohoLeadData = ZohoLeadPayload['data']

type ZohoScriptConfig = {
  workflowId?: string
  workflowTargetMap?: Record<string, string>
  workflowTargetFallbackFields?: Record<string, string>
  customFieldMap?: Record<string, string>
}

export const handler = wrapConnectHandler<ZohoLeadPayload>(async (input, client) => {
  const { payload, config } = input.context
  const scriptConfig = config.scriptConfig as unknown as ZohoScriptConfig
  const { data } = payload

  console.log('Incoming Zoho payload:', JSON.stringify(payload))

  if (isNotDefined(data.Street)) {
    console.log('Skipping: No address detected')
    return
  }

  const sourceId = String(data.id ?? data.Id ?? data.ID ?? '').trim()

  if (!sourceId) {
    throw new Error(`Missing Zoho record ID. Keys: ${Object.keys(data).join(', ')}`)
  }

  const workflowTargetFallbackFields = Object.keys(scriptConfig.workflowTargetFallbackFields ?? {})
  const workflowTarget = resolveWorkflowTarget(data, scriptConfig.workflowTargetMap ?? {}, workflowTargetFallbackFields)

  const request: AccountUpsertInput = {
    requestType: 'upsert',
    account: {
      sourceId,
      externalLeadId: sourceId,
      accountSource: toTrimmedString(data.Lead_Source) ?? 'Zoho',
      workflowId: scriptConfig.workflowId as WorkflowId,
      workflowTarget,
      sourceStatus: workflowTarget,

      resident: {
        firstName: toTrimmedString(data.First_Name),
        lastName: toTrimmedString(data.Last_Name),
        email: toTrimmedString(data.Email),
        phone: toTrimmedString(data.Mobile),
      },

      location: {
        line1: toTrimmedString(data.Street),
        unitNbr: toTrimmedString(data.Address_Line_2),
        locality: toTrimmedString(data.City),
        countrySubd: toTrimmedString(data.State),
        postal1: toTrimmedString(data.Zip_Code),
        latlng: {
          latitude: toTrimmedNumber(data.Latitude),
          longitude: toTrimmedNumber(data.Longitude),
        },
      },

      customFields: resolveCustomFields(data, scriptConfig.customFieldMap ?? {}),
    },
  }

  console.log('Terros payload', JSON.stringify(request))

  const response = await client.call('account/upsert', request)

  console.log('Terros response', JSON.stringify(response))

  return
})

function resolveWorkflowTarget(
  data: ZohoLeadData,
  targetMap: Record<string, string>,
  fallbackFields: string[]
): string | undefined {
  for (const [field, target] of Object.entries(targetMap)) {
    if (isDefined(data[field])) return target
  }

  for (const field of fallbackFields) {
    const value = toTrimmedString(data[field])
    if (value !== undefined) return value
  }

  return undefined
}

function resolveCustomFields(data: ZohoLeadData, fieldMap: Record<string, string>): Record<string, string> {
  const customFields: Record<string, string | undefined> = {}
  for (const [zohoField, terrosFieldId] of Object.entries(fieldMap)) {
    customFields[terrosFieldId] = toTrimmedString(data[zohoField])
  }
  return omitUndefinedValues(customFields)
}

function toTrimmedString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined
  const stringValue = String(value).trim()
  return stringValue === '' ? undefined : stringValue
}

function toTrimmedNumber(value: any): number | undefined {
  const stringValue = toTrimmedString(value)
  if (stringValue === undefined) return undefined
  const numberValue = Number(stringValue)
  return Number.isNaN(numberValue) ? undefined : numberValue
}

function isNotDefined(value: any): boolean {
  return !isDefined(value)
}

function isDefined(value: any): boolean {
  if (value === undefined) return false
  if (value === null) return false
  if (String(value).trim() === '') return false
  return true
}

function omitUndefinedValues(object: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(object).filter((entry): entry is [string, string] => isDefined(entry[1])))
}
