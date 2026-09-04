import type { CustomFieldId, CustomFieldMap, TerrosClient, TinyTeam, UserId } from '@terros-inc/sdk'

export type GoHighLevelCustomField = {
  key: string
  fieldValue: string | number | boolean
}

type AccountFieldSource = {
  customFieldMap?: CustomFieldMap
}

export type RoutedUser = {
  userId?: UserId
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

export async function resolveGoHighLevelTeam(client: TerrosClient, user: RoutedUser): Promise<TinyTeam> {
  if (!user.userId) throw Error('No userId found')

  const { user: fullUser } = await client.user.get({ userId: user.userId })
  const primaryTeamId = fullUser.primaryTeam?.teamId
  if (!primaryTeamId) throw Error(`User ${user.userId} has no primary teamId`)

  return (await client.team.get({ teamId: primaryTeamId })).team
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
    throw Error(`GHL request failed: ${response.status} ${response.statusText} ${body}`)
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

export function toContactFieldValues(
  account: AccountFieldSource,
  mappings?: Record<string, string> | null
): GoHighLevelCustomField[] {
  const customFields: GoHighLevelCustomField[] = []

  for (const [terrosAccountField, goHighLevelMergeField] of Object.entries(mappings ?? {})) {
    const fieldValue = getAccountFieldValue(account, terrosAccountField)
    if (fieldValue === undefined || fieldValue === null) continue

    const fieldKey = parseContactMergeField(goHighLevelMergeField)
    if (!fieldKey) continue

    if (typeof fieldValue !== 'string' && typeof fieldValue !== 'number' && typeof fieldValue !== 'boolean') {
      throw Error(`Cannot send non-primitive Terros field ${terrosAccountField} to a GoHighLevel custom field`)
    }
    customFields.push({ key: fieldKey, fieldValue })
  }

  return customFields
}

function getAccountFieldValue(account: AccountFieldSource, field: string): unknown {
  if (isCustomFieldId(field)) return account.customFieldMap?.[field]

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

function parseContactMergeField(mergeField: string): string | undefined {
  const match = /^\{\{\s*contact\.([^{}\s]+)\s*\}\}$/.exec(mergeField)
  const fieldKey = match?.[1]
  if (!fieldKey) console.warn(`Invalid GoHighLevel contact merge field ${mergeField}`)
  return fieldKey
}
