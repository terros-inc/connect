import { DateTime } from 'luxon'

export function formatOutput(value: unknown): string | undefined {
  return JSON.stringify(withLocalDates(value), null, 2)
}

function withLocalDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withLocalDates)
  if (value === null || typeof value !== 'object') return value

  const entries: [string, unknown][] = []
  for (const [key, field] of Object.entries(value)) {
    entries.push([key, withLocalDates(field)])
    const sibling = `${key}Local`
    if (
      (key === 'timestamp' || key === 'firstAccess' || key === 'lastAccess' || key.endsWith('At')) &&
      typeof field === 'number' &&
      Number.isSafeInteger(field) &&
      !Object.hasOwn(value, sibling)
    ) {
      const date = DateTime.fromMillis(field)
      if (date.isValid) entries.push([sibling, { iso: date.toISO(), timeZone: date.zoneName }])
    }
  }
  return Object.fromEntries(entries)
}
