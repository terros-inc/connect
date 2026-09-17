import { isAppointmentCanceled, toEventTime } from './calendarIncoming.ts'

describe('incoming GoHighLevel appointments', () => {
  test('converts an appointment time to a Terros event time', () => {
    expect(
      toEventTime({
        startTime: '2026-09-01T17:00:00.000Z',
        endTime: '2026-09-01T18:30:00.000Z',
      })
    ).toEqual({
      eventDate: Date.parse('2026-09-01T17:00:00.000Z'),
      duration: 90,
    })
  })

  test('rejects an invalid appointment time', () => {
    expect(() => toEventTime({ startTime: 'invalid', endTime: 'invalid' })).toThrow(
      'GoHighLevel appointment has invalid startTime or endTime'
    )
  })

  test('recognizes deleted and cancelled appointments', () => {
    expect(isAppointmentCanceled('AppointmentDelete', 'confirmed')).toBe(true)
    expect(isAppointmentCanceled('AppointmentUpdate', 'cancelled')).toBe(true)
    expect(isAppointmentCanceled('AppointmentUpdate', 'confirmed')).toBe(false)
  })
})
