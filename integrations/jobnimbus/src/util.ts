export function normalizeEmail(email: string | undefined): string {
  return String(email || '')
    .trim()
    .toLowerCase()
}

export function removeUndefinedValues(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

export function findFirstMappedValue(
  source: Record<string, unknown>,
  fieldMapping: Record<string, string>,
  valueMapping: Record<string, string>
): string | undefined {
  for (const field of Object.keys(fieldMapping || {})) {
    const value = getPathValue(source, field)
    const mappedValue = valueMapping?.[String(value)]

    if (mappedValue) return mappedValue
  }

  return undefined
}

function getPathValue(source: Record<string, unknown>, field: string): unknown {
  const path = removePayloadPrefix(field)

  return path.split('.').reduce<unknown>((value, key) => {
    if (!value) return undefined
    return (value as Record<string, unknown>)[key]
  }, source)
}

function removePayloadPrefix(field: string): string {
  if (field.startsWith('account.')) return field.slice('account.'.length)
  if (field.startsWith('payload.')) return field.slice('payload.'.length)
  return field
}

export function getRequestType(request: string | undefined): 'add' | 'update' | 'upsert' {
  if (!request) return 'upsert'
  const normalized = request.trim().toLowerCase()
  if (normalized === 'update') return 'update'
  if (normalized === 'create') return 'add'
  return 'upsert'
}

export function cleanNullValue(value: string | null | undefined): string | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined
  if (value === null || value === undefined) return undefined
  return value
}

export function toMilliseconds(value: number | string | undefined): number | undefined {
  if (!value) return undefined

  const number = Number(value)
  if (!Number.isFinite(number)) return undefined

  if (number < 10_000_000_000) return number * 1000
  return number
}
