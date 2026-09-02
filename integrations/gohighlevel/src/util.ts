import type { AccountWebhookData, CustomFieldId } from '@terros-inc/sdk'

export type GoHighLevelCustomField = {
  id: string
  fieldValue: string | number | boolean
}

type AccountFieldSource = {
  customFields?: AccountWebhookData['customFields']
}

const baseUrl = 'https://services.leadconnectorhq.com'

export function getPrivateIntegrationToken(
  secrets: { privateIntegrationTokens: Record<string, string> },
  locationId: string
): string {
  const accessToken = secrets.privateIntegrationTokens[locationId]
  if (!accessToken) throw Error(`Missing GoHighLevel private integration token for location ${locationId}`)
  return accessToken
}

export async function ghlApi<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000)
    throw Error(`GoHighLevel request failed: ${response.status} ${response.statusText} ${body}`)
  }

  return response.json() as Promise<T>
}

export function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  return trimmed || undefined
}

export function toGoHighLevelCustomFields(
  account: AccountFieldSource,
  mappings: Record<string, string>
): GoHighLevelCustomField[] {
  const goHighLevelCustomFields: GoHighLevelCustomField[] = []

  for (const [terrosAccountField, goHighLevelCustomFieldId] of Object.entries(mappings)) {
    const fieldValue = getAccountFieldValue(account, terrosAccountField)
    if (fieldValue === undefined || fieldValue === null) continue

    switch (typeof fieldValue) {
      case 'string':
      case 'number':
      case 'boolean':
        goHighLevelCustomFields.push({ id: goHighLevelCustomFieldId, fieldValue })
        break
      default:
        throw Error(`Cannot send non-primitive Terros field ${terrosAccountField} to a GoHighLevel custom field`)
    }
  }

  return goHighLevelCustomFields
}

function getAccountFieldValue(account: AccountFieldSource, field: string): unknown {
  if (isCustomFieldId(field)) return account.customFields?.[field]

  const accountField = field.startsWith('account.') ? field.slice('account.'.length) : field
  let fieldValue: unknown = account

  for (const key of accountField.split('.')) {
    if (typeof fieldValue !== 'object' || fieldValue === null) return
    fieldValue = Reflect.get(fieldValue, key)
  }

  return fieldValue
}

function isCustomFieldId(field: string): field is CustomFieldId {
  return field.startsWith('CF.')
}
