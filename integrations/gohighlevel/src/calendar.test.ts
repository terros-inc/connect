import { getAppointmentUpdate, readAppointment, toAppointment } from './calendar.ts'

describe('GoHighLevel appointments', () => {
  test('builds a notifying appointment with a Google Meet location', () => {
    const event = {
      title: 'Solar Consultation',
      eventDate: '2026-09-01T17:00:00.000Z',
      duration: 90,
      address: {
        line1: '123 Main St',
        line2: '',
        locality: 'Victoria',
        countrySubd: 'BC',
        postal1: '',
        latlng: {
          latitude: 48.4284,
          longitude: -123.3656,
        },
      },
    }
    const config = {
      locationId: 'ghl-location',
      calendarId: 'ghl-calendar',
      pipelineId: 'ghl-pipeline',
    }

    expect(toAppointment(event, config, 'ghl-contact', 'ghl-user')).toEqual({
      calendarId: 'ghl-calendar',
      locationId: 'ghl-location',
      contactId: 'ghl-contact',
      title: 'Solar Consultation',
      startTime: '2026-09-01T17:00:00.000Z',
      endTime: '2026-09-01T18:30:00.000Z',
      appointmentStatus: 'confirmed',
      assignedUserId: 'ghl-user',
      meetingLocationType: 'gmeet',
      toNotify: true,
      ignoreDateRange: true,
      ignoreFreeSlotValidation: true,
    })
    expect(toAppointment(event, config, 'ghl-contact', 'ghl-user')).not.toHaveProperty('meetingLocationId')
    expect(toAppointment(event, config, 'ghl-contact', 'ghl-user')).not.toHaveProperty('address')
    expect(toAppointment(event, config, 'ghl-contact', 'ghl-user')).not.toHaveProperty('rrule')
  })

  test('detects appointment time changes', () => {
    const input: ReturnType<typeof toAppointment> = {
      calendarId: 'ghl-calendar',
      locationId: 'ghl-location',
      contactId: 'ghl-contact',
      title: 'Solar Consultation',
      startTime: '2026-09-01T17:00:00.000Z',
      endTime: '2026-09-01T18:30:00.000Z',
      appointmentStatus: 'confirmed',
      assignedUserId: 'ghl-user',
      meetingLocationType: 'gmeet',
      toNotify: true,
      ignoreDateRange: true,
      ignoreFreeSlotValidation: true,
    }
    const appointment = {
      id: 'ghl-appointment',
      calendarId: 'ghl-calendar',
      locationId: 'ghl-location',
      contactId: 'ghl-contact',
      title: 'Solar Consultation',
      startTime: '2026-09-01T17:00:00.000Z',
      endTime: '2026-09-01T18:30:00.000Z',
      appointmentStatus: 'confirmed',
      assignedUserId: 'ghl-user',
    }

    expect(getAppointmentUpdate(appointment, input)).toBeUndefined()
    expect(
      getAppointmentUpdate({ ...appointment, title: 'Renamed', appointmentStatus: 'showed' }, input)
    ).toBeUndefined()
    expect(getAppointmentUpdate(appointment, { ...input, assignedUserId: 'other-user' })).toBeUndefined()
    expect(getAppointmentUpdate({ ...appointment, assignedUserId: undefined }, input)).toEqual({
      assignedUserId: 'ghl-user',
    })
    expect(getAppointmentUpdate({ ...appointment, startTime: '2026-09-01T17:30:00.000Z' }, input)).toEqual({
      startTime: input.startTime,
      endTime: input.endTime,
      toNotify: true,
      ignoreDateRange: true,
      ignoreFreeSlotValidation: true,
    })
  })
})

describe('readAppointment', () => {
  const appointment = { id: 'appt-1', calendarId: 'cal', contactId: 'c1', startTime: 'a', endTime: 'b' }

  test('reads the documented event wrapper', () => {
    expect(readAppointment({ event: appointment })).toEqual(appointment)
  })

  test('reads an appointment wrapper', () => {
    expect(readAppointment({ appointment })).toEqual(appointment)
  })

  test('reads an unwrapped appointment', () => {
    expect(readAppointment(appointment)).toEqual(appointment)
  })

  test.each([null, 'x', [], {}, { event: null }, { event: {} }, { events: [appointment] }])(
    'returns nothing for %j',
    (body) => {
      expect(readAppointment(body)).toBeUndefined()
    }
  )
})
