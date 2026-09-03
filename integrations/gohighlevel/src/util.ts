import type { CustomFieldId, CustomFieldMap, TeamId, TerrosClient, TinyTeam, UserId } from '@terros-inc/sdk'

export type GoHighLevelCustomField = {
  id: string
  fieldValue: string | number | boolean
}

export type GoHighLevelStandardContactField =
  | 'firstName'
  | 'lastName'
  | 'name'
  | 'email'
  | 'phone'
  | 'address1'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'assignedTo'
  | 'source'

export type GoHighLevelContactFieldValues = {
  standardFields: Partial<Record<GoHighLevelStandardContactField, string>>
  customFields: GoHighLevelCustomField[]
}

type AccountFieldSource = {
  customFieldMap?: CustomFieldMap
}

export type RoutedUser = {
  userId?: UserId
  teamIds?: TeamId[]
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
  const firstTeamId = user.teamIds?.[0]
  const firstTeam = firstTeamId ? (await client.team.get({ teamId: firstTeamId })).team : undefined
  if (firstTeam?.externalId) return firstTeam

  const { user: fullUser } = await client.user.get({ userId: user.userId })
  const primaryTeamId = fullUser.primaryTeam?.teamId
  if (!primaryTeamId) {
    if (firstTeam) return firstTeam
    throw Error(`Terros user ${user.userId} has no primary teamId`)
  }
  if (primaryTeamId === firstTeamId) {
    throw Error(`${primaryTeamId} has no GoHighLevel location ID`)
  }

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

export function toGoHighLevelContactFieldValues(
  account: AccountFieldSource,
  mappings?: Record<string, string> | null
): GoHighLevelContactFieldValues {
  const standardFields: Partial<Record<GoHighLevelStandardContactField, string>> = {}
  const customFields: GoHighLevelCustomField[] = []

  for (const [terrosAccountField, goHighLevelContactField] of Object.entries(mappings ?? {})) {
    const fieldValue = getAccountFieldValue(account, terrosAccountField)
    if (fieldValue === undefined || fieldValue === null) continue

    if (isGoHighLevelStandardContactField(goHighLevelContactField)) {
      if (typeof fieldValue !== 'string') {
        throw Error(`Cannot send non-string Terros field ${terrosAccountField} to ${goHighLevelContactField}`)
      }
      standardFields[goHighLevelContactField] = fieldValue
      continue
    }

    switch (typeof fieldValue) {
      case 'string':
      case 'number':
      case 'boolean':
        customFields.push({ id: goHighLevelContactField, fieldValue })
        break
      default:
        throw Error(`Cannot send non-primitive Terros field ${terrosAccountField} to a GoHighLevel custom field`)
    }
  }

  return { standardFields, customFields }
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

function isGoHighLevelStandardContactField(field: string): field is GoHighLevelStandardContactField {
  switch (field) {
    case 'firstName':
    case 'lastName':
    case 'name':
    case 'email':
    case 'phone':
    case 'address1':
    case 'city':
    case 'state':
    case 'postalCode':
    case 'assignedTo':
    case 'source':
      return true
    default:
      return false
  }
}
