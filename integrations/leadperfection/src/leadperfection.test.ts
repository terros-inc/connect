import { IntegrationError, PermanentError } from '@terros-inc/sdk'
import { readSecrets } from './leadperfection.ts'
import { jobStatusChangeRow } from './fixtures.ts'
import { fakeLeadPerfection, fakeSecrets } from './fakeLeadPerfection.ts'

const appointments = (lp: ReturnType<typeof fakeLeadPerfection>) =>
  lp.client.getSalesAppointments('11/16/2026', '11/18/2026')

describe('LeadPerfection tokens', () => {
  // The old client kept one token in a static field for every company, so a second customer's calls ran with the
  // first customer's token and site.
  it('keeps one token per install and sends each install its own', async () => {
    const first = fakeLeadPerfection()
    const second = fakeLeadPerfection()

    await appointments(first)
    await appointments(first)
    await appointments(second)

    expect(first.paths()).toEqual(['/token', ...Array(2).fill('/api/SalesApi/GetSalesApptDetailDateRange')])
    expect(second.paths()).toEqual(['/token', '/api/SalesApi/GetSalesApptDetailDateRange'])
    expect(first.calls[1]?.authorization).toBe('Bearer token-1')
    expect(second.calls[1]?.authorization).toBe('Bearer token-1')
  })

  // Every endpoint, /token included, takes a form-encoded POST; the old client sent JSON.
  it('form-encodes the token request and calls on the install server', async () => {
    const secrets = fakeSecrets({ server: 'api2', password: 'p&ss=word' })
    const lp = fakeLeadPerfection({ secrets })

    await appointments(lp)

    expect(lp.calls[0]).toMatchObject({
      url: 'https://api2.leadperfection.com/token',
      contentType: 'application/x-www-form-urlencoded',
      form: {
        grant_type: 'password',
        username: secrets.username,
        password: 'p&ss=word',
        clientid: secrets.clientId,
        appkey: secrets.appKey,
      },
    })
    expect(lp.calls[1]).toMatchObject({
      url: 'https://api2.leadperfection.com/api/SalesApi/GetSalesApptDetailDateRange',
      contentType: 'application/x-www-form-urlencoded',
      form: { apptdates: '11/16/2026', apptdatee: '11/18/2026' },
    })
  })

  it('renews a token before its 24 hours run out', async () => {
    const lp = fakeLeadPerfection()
    await appointments(lp)

    lp.clock.time += 23 * 3_600_000
    await appointments(lp)
    expect(lp.paths().filter((path) => path === '/token')).toHaveLength(1)

    lp.clock.time += 55 * 60_000
    await appointments(lp)
    expect(lp.paths().filter((path) => path === '/token')).toHaveLength(2)
    expect(lp.calls.at(-1)?.authorization).toBe('Bearer token-2')
  })

  it('gets a new token once when LeadPerfection refuses the cached one', async () => {
    const lp = fakeLeadPerfection()
    await appointments(lp)
    lp.revokeTokens()

    await appointments(lp)

    expect(lp.paths().slice(2)).toEqual([
      '/api/SalesApi/GetSalesApptDetailDateRange',
      '/token',
      '/api/SalesApi/GetSalesApptDetailDateRange',
    ])
  })

  it('does not loop when a fresh token is refused too, and leaves the run retryable', async () => {
    const invalid = { status: 401, body: { Message: 'Invalid Token, Please Regenerate Token and Try Again!' } }
    const lp = fakeLeadPerfection({ fail: { '/api/SalesApi/GetSalesApptDetailDateRange': [invalid, invalid] } })

    const error = await appointments(lp).catch((caught: unknown) => caught)

    expect(error).not.toBeInstanceOf(PermanentError)
    expect(lp.paths().filter((path) => path === '/token')).toHaveLength(2)
  })
})

describe('LeadPerfection errors', () => {
  it.each([
    ['bad credentials', { password: 'other-password' }, 'INVALID USER NAME/PASSWORD'],
    ['an unknown site code', { clientId: 'other' }, 'Invalid ClientID'],
  ])('reports %s as the customer’s to fix', async (_, accepts, message) => {
    const lp = fakeLeadPerfection({ accepts })

    const error = await appointments(lp).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IntegrationError)
    expect((error as Error).message).toContain(message)
  })

  it('names the APISECURITY permission the user lacks', async () => {
    const denied = { status: 401, body: { Message: 'You do not have permission to execute action' } }
    const lp = fakeLeadPerfection({ fail: { '/api/Customers/GetLead': [denied] } })

    const error = await lp.client.getLeadLinks('1001').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IntegrationError)
    expect((error as Error).message).toContain('APISECURITY function permission for GetLead')
    expect(lp.paths().filter((path) => path === '/token')).toHaveLength(1)
  })

  it.each([429, 503])('leaves %s retryable', async (status) => {
    const lp = fakeLeadPerfection({
      fail: { '/api/SalesApi/GetSalesApptDetailDateRange': [{ status, body: { Message: 'busy' } }] },
    })

    const error = await appointments(lp).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PermanentError)
  })

  it('refuses a server that is not a bare host prefix', () => {
    const secrets = { ...fakeSecrets(), server: 'evil.example/' }
    expect(() => readSecrets(secrets)).toThrow(IntegrationError)
    expect(readSecrets({ ...secrets, server: ' API3 ' }).server).toBe('api3')
  })
})

describe('GetJobStatusChanges paging', () => {
  const jobs = Array.from({ length: 250 }, (_, index) => ({ ...jobStatusChangeRow, job_id: String(index + 1) }))

  // StartIndex is a page number: reading it as a record offset (101, 201) would skip or repeat rows.
  it('pages by page number until a short page', async () => {
    const lp = fakeLeadPerfection({ jobs })

    const { rows, complete } = await lp.client.getJobStatusChanges('11/16/2026', '11/19/2026', 100, 5)

    expect(lp.calls.slice(1).map((call) => call.form.StartIndex)).toEqual(['1', '2', '3'])
    expect(lp.calls[1]?.form).toMatchObject({ startdate: '11/16/2026', enddate: '11/19/2026', PageSize: '100' })
    expect(rows.map((row) => row.job_id)).toEqual(jobs.map((job) => job.job_id))
    expect(complete).toBe(true)
  })

  // Ascending order would read the same oldest pages on every run and never reach the newest changes.
  it('stops at the page limit with the newest changes, oldest first', async () => {
    const lp = fakeLeadPerfection({ jobs })

    const { rows, complete } = await lp.client.getJobStatusChanges('11/16/2026', '11/19/2026', 100, 2)

    expect(lp.calls[1]?.form.sortorder).toBe('4')
    expect(rows.map((row) => row.job_id)).toEqual(jobs.slice(50).map((job) => job.job_id))
    expect(complete).toBe(false)
  })
})
