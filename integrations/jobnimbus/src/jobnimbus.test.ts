import { type AccountWebhookData } from '@terros-inc/sdk'
import { toJobNimbusRecord } from './jobnimbus.ts'

// Shaped like the Account webhook Terros sends: the homeowner is `resident` and the address is `address`.
// Reading the wrong fields named every job "Terros Account <id>" with no address.
const account: AccountWebhookData = {
  id: 'Account.example',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  resident: { firstName: 'Quinn', lastName: 'Example', email: 'quinn@example.test', phone: '5550100' },
  address: {
    line1: '123 Main St',
    locality: 'Springfield',
    countrySubd: 'IL',
    postal1: '62701',
    latlng: { latitude: 39.78, longitude: -89.65 },
  },
}

describe('JobNimbus records', () => {
  test('names a job after the resident and sends the address', () => {
    const job = toJobNimbusRecord(account, 'rep-1', { defaultStatus: 'Lead' }, 'job')

    expect(job).toMatchObject({
      name: 'Quinn Example',
      address_line1: '123 Main St',
      city: 'Springfield',
      state_text: 'IL',
      zip: '62701',
      geo: { lat: 39.78, lon: -89.65 },
    })
  })

  test('fills contact name, email and phone from the resident', () => {
    const contact = toJobNimbusRecord(account, 'rep-1', { defaultStatus: 'Lead' }, 'contact')

    expect(contact).toMatchObject({
      first_name: 'Quinn',
      last_name: 'Example',
      display_name: 'Quinn Example',
      email: 'quinn@example.test',
      home_phone: '5550100',
      address_line1: '123 Main St',
    })
  })
})
