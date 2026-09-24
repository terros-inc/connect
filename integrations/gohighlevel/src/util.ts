import type { CustomFieldId, CustomFieldMap } from '@terros-inc/sdk'

const baseUrl = 'https://services.leadconnectorhq.com'

export function isEmpty(values: readonly unknown[]): boolean {
  return values.length === 0
}

export function isNotEmpty(values: readonly unknown[]): boolean {
  return !isEmpty(values)
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

export function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  return trimmed || undefined
}

type NamedUser = {
  name?: string
  preferredName?: string
  firstName?: string
  lastName?: string
}

export function getUserName(user: NamedUser | undefined): string {
  if (!user) return 'Unknown'
  return (
    user.preferredName?.trim() ||
    user.name?.trim() ||
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    'Unknown'
  )
}

type NoteSource = 'GHL' | 'Terros'

export function formatNote(authorName: string, source: NoteSource, sourceNoteId: string, body: string): string {
  return `${authorName} (${source} ${sourceNoteId}): ${body}`
}

type AccountFieldSource = {
  customFieldMap?: CustomFieldMap
}

export type GoHighLevelCustomField = {
  key: string
  fieldValue: string | number | boolean
}

export function toContactFields(
  account: AccountFieldSource,
  mappings?: Record<string, string> | null
): GoHighLevelCustomField[] {
  const customFields: GoHighLevelCustomField[] = []

  for (const [terrosAccountField, goHighLevelMergeField] of Object.entries(mappings ?? {})) {
    const fieldValue = getFieldValue(account, terrosAccountField)
    if (fieldValue === undefined || fieldValue === null) continue

    const fieldKey = parseMergeField(goHighLevelMergeField)
    if (!fieldKey) continue

    if (typeof fieldValue !== 'string' && typeof fieldValue !== 'number' && typeof fieldValue !== 'boolean') {
      throw Error(`Cannot send non-primitive Terros field ${terrosAccountField} to a GoHighLevel custom field`)
    }
    customFields.push({ key: fieldKey, fieldValue })
  }

  return customFields
}

function getFieldValue(account: AccountFieldSource, field: string): unknown {
  if (isCustomId(field)) return account.customFieldMap?.[field]

  const accountField = field.startsWith('account.') ? field.slice('account.'.length) : field
  let fieldValue: unknown = account

  for (const key of accountField.split('.')) {
    if (typeof fieldValue !== 'object' || fieldValue === null) return
    fieldValue = Reflect.get(fieldValue, key)
  }

  return fieldValue
}

function isCustomId(field: string): field is CustomFieldId {
  return field.startsWith('CF.')
}

function parseMergeField(mergeField: string): string | undefined {
  const match = /^\{\{\s*contact\.([^{}\s]+)\s*\}\}$/.exec(mergeField)
  const fieldKey = match?.[1]
  if (!fieldKey) console.warn(`Invalid GoHighLevel contact merge field ${mergeField}`)
  return fieldKey
}
