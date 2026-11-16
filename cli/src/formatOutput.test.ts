import { Settings } from 'luxon'
import { formatOutput } from './formatOutput'

const originalZone = Settings.defaultZone
beforeEach(() => {
  Settings.defaultZone = 'America/Los_Angeles'
})
afterEach(() => {
  Settings.defaultZone = originalZone
})

it('keeps raw user timestamps and adds local dates through nested objects and arrays', () => {
  const input = {
    lastAccess: 1767225600000,
    firstAccess: 1751328000000,
    createdAt: 0,
    modifiedBy: [{ timestamp: 1767225600000 }],
    logins: [{ timestamp: 1751328000000 }],
  }
  const winter = { iso: '2025-12-31T16:00:00.000-08:00', timeZone: 'America/Los_Angeles' }
  const summer = { iso: '2025-06-30T17:00:00.000-07:00', timeZone: 'America/Los_Angeles' }
  expect(JSON.parse(formatOutput(input)!)).toEqual({
    ...input,
    lastAccessLocal: winter,
    firstAccessLocal: summer,
    createdAtLocal: { iso: '1969-12-31T16:00:00.000-08:00', timeZone: 'America/Los_Angeles' },
    modifiedBy: [{ timestamp: 1767225600000, timestampLocal: winter }],
    logins: [{ timestamp: 1751328000000, timestampLocal: summer }],
  })
  expect(input.modifiedBy).toEqual([{ timestamp: 1767225600000 }])
})

it('preserves existing siblings, unrelated numbers, and invalid or nonnumeric date values', () => {
  const input = [
    { timestamp: 1767225600000, timestampLocal: 'server value' },
    { count: 1767225600000, id: 1767225600000, updatedAt: null },
    { createdAt: '1767225600000', lastAccess: 1.5 },
    { timestamp: 8640000000000001 },
    null,
    'unchanged',
  ]
  expect(JSON.parse(formatOutput(input)!)).toEqual(input)
})

it('prints an explicit offset and zone even for UTC and fractional-hour zones', () => {
  Settings.defaultZone = 'UTC'
  expect(JSON.parse(formatOutput({ timestamp: 1767225600000 })!).timestampLocal).toEqual({
    iso: '2026-01-01T00:00:00.000Z',
    timeZone: 'UTC',
  })
  Settings.defaultZone = 'Asia/Kolkata'
  expect(JSON.parse(formatOutput({ timestamp: 1767225600000 })!).timestampLocal).toEqual({
    iso: '2026-01-01T05:30:00.000+05:30',
    timeZone: 'Asia/Kolkata',
  })
})
