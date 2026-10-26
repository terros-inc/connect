import { ServiceTitanClient } from './servicetitan.ts'
import { fakeServiceTitan } from './fakeServiceTitan.ts'

afterEach(() => vi.useRealTimers())

it('keeps OAuth tokens isolated by both client ID and client secret across installs', async () => {
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({ ids: ['2000'] })
  await new ServiceTitanClient(fake.secrets, fake.fakeFetch).searchTechnicians({})
  await new ServiceTitanClient(
    { ...fake.secrets, clientSecret: 'other-example-secret' },
    fake.fakeFetch
  ).searchTechnicians({})
  await new ServiceTitanClient({ ...fake.secrets, clientId: 'other-example-client' }, fake.fakeFetch).searchTechnicians(
    {}
  )
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(3)
})

it('refreshes the token sixty seconds early so an expiring token is not sent', async () => {
  vi.useFakeTimers()
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({})
  vi.advanceTimersByTime(839_000)
  await fake.client.searchTechnicians({})
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(1)
  vi.advanceTimersByTime(1000)
  await fake.client.searchTechnicians({})
  expect(fake.calls.filter((call) => call.url.hostname.startsWith('auth.'))).toHaveLength(2)
})

it('sends tenant-scoped URLs, credentials, app key and timeouts without mixing name and ID lookup', async () => {
  const fake = fakeServiceTitan()
  await fake.client.searchTechnicians({ ids: ['2000'], name: 'Ignored Example' })
  const auth = fake.calls[0]!
  expect(auth.url.href).toBe('https://auth.servicetitan.io/connect/token')
  expect(auth.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded')
  expect(new URLSearchParams(String(auth.body)).get('grant_type')).toBe('client_credentials')
  expect(new URLSearchParams(String(auth.body)).get('client_secret')).toBe(fake.secrets.clientSecret)
  const call = fake.calls[1]!
  expect(call.url.href).toBe('https://api.servicetitan.io/settings/v2/tenant/1000/technicians?ids=2000')
  expect(call.headers.get('Authorization')).toBe('Bearer example-token')
  expect(call.headers.get('ST-App-Key')).toBe('example-key')
  expect(call.signal).toBeInstanceOf(AbortSignal)
  await fake.client.searchTechnicians({ name: 'Example Closer' })
  expect(fake.calls.at(-1)!.url.searchParams.get('name')).toBe('Example Closer')
})

it('throws on missing linked records while returning write failures for legacy handling', async () => {
  const fake = fakeServiceTitan()
  await expect(fake.client.getJob(9999)).rejects.toThrow('job not found')
  await expect(fake.client.getAppointment(9999)).rejects.toThrow('appointment not found')
  await expect(fake.client.getLocation(9999)).rejects.toThrow('location not found')
  expect(await fake.client.updateJob(9999, { campaignId: 1002, customFields: [] })).toMatchObject({ ok: false })
})
