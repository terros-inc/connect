import { toAppointmentInput } from './calendar.ts'

describe('GoHighLevel appointments', () => {
  test('builds a notifying appointment from a Terros calendar event', () => {
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
    const route = {
      teamId: 'Team.victoria' as const,
      locationId: 'ghl-location',
      calendarId: 'ghl-calendar',
    }

    expect(toAppointmentInput(event, route, 'ghl-contact', 'ghl-user')).toEqual({
      calendarId: 'ghl-calendar',
      locationId: 'ghl-location',
      contactId: 'ghl-contact',
      title: 'Solar Consultation',
      startTime: '2026-09-01T17:00:00.000Z',
      endTime: '2026-09-01T18:30:00.000Z',
      appointmentStatus: 'confirmed',
      assignedUserId: 'ghl-user',
      address: '123 Main St',
      toNotify: true,
      ignoreDateRange: true,
      ignoreFreeSlotValidation: true,
    })
    expect(toAppointmentInput(event, route, 'ghl-contact', 'ghl-user')).not.toHaveProperty('rrule')
  })
})
