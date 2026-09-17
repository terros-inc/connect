import { toEventTime } from './calendarIncoming.ts'

describe('incoming GoHighLevel appointments', () => {
  test('converts an appointment time to a Terros event time', () => {
    expect(
      toEventTime({
        startTime: '2026-09-01T17:00:00',
        endTime: '2026-09-01T18:30:00',
        selectedTimezone: 'America/Los_Angeles',
      })
    ).toEqual({
      startDate: Date.parse('2026-09-02T00:00:00.000Z'),
      endDate: Date.parse('2026-09-02T01:30:00.000Z'),
      duration: 90,
    })
  })

  test('rejects an invalid appointment time', () => {
    expect(() =>
      toEventTime({ startTime: 'invalid', endTime: 'invalid', selectedTimezone: 'America/Los_Angeles' })
    ).toThrow('Invalid startTime')
  })
})
