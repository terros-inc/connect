import type { AccountWebhookData } from '@terros-inc/sdk'
import { getAccountToSend, sendAccount } from './outgoing.ts'
import { fakeJobNimbus, fakeTerros } from './fakeJobNimbus.ts'

const users = [{ id: 'user-1', email: 'rep@example.test' }]
const config = {
  statusFields: { 'workflowState.stageName': '' },
  statusValues: { 'Damage Found': 'Lead' },
  workflowType: 'Insurance',
}

function account(stageName: string, overrides: Partial<AccountWebhookData> = {}): AccountWebhookData {
  return {
    id: 'Account.example',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    owner: { userId: 'U.example', firstName: 'Rep', lastName: 'Example', email: 'rep@example.test' },
    workflowState: { workflowId: 'WF.example', stageId: 'S.example', stageName },
    resident: { firstName: 'Quinn', lastName: 'Example', email: 'quinn@example.test', phone: '5550100' },
    ...overrides,
  }
}

describe('sendAccount', () => {
  // Prevents an unlinked account (created again on every change) or a job without its mapped status and type.
  test('creates a job with the mapped status and links the account', async () => {
    const { client, jobs } = fakeJobNimbus({ users })
    const { terros, updates } = fakeTerros()

    await sendAccount(account('Damage Found'), config, client, terros)

    expect([...jobs.values()]).toEqual([
      expect.objectContaining({
        jnid: 'jn-1',
        name: 'Quinn Example',
        external_id: 'Account.example',
        sales_rep: 'user-1',
        status_name: 'Lead',
        record_type_name: 'Insurance',
      }),
    ])
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'jn-1' } }])
  })

  // Sending the status on every update reset jobs back to the starting status in JobNimbus.
  test('updates a linked job without resetting its status', async () => {
    const existing = { jnid: 'jn-job', external_id: 'Account.example', status_name: 'Signed Contract' }
    const { client, jobs, calls } = fakeJobNimbus({ users, jobs: [existing] })
    const { terros } = fakeTerros()

    await sendAccount(account('Damage Found', { externalLeadId: 'jn-job' }), config, client, terros)

    expect(calls.find((call) => call.method === 'PUT')?.body).not.toHaveProperty('status_name')
    expect(jobs.get('jn-job')).toMatchObject({ status_name: 'Signed Contract', name: 'Quinn Example' })
    expect(jobs.size).toBe(1)
  })

  // Without a mapped status, or before the resident's details are in, every early door knock created a nameless job.
  test('creates nothing for an unmapped stage or missing required fields', async () => {
    const { client, calls } = fakeJobNimbus({ users })
    const { terros } = fakeTerros()

    await sendAccount(account('Knock'), config, client, terros)
    await sendAccount(
      account('Damage Found', { resident: { firstName: 'Quinn', lastName: 'Example' } }),
      { ...config, requiredFields: 'firstName, lastName, phone' },
      client,
      terros
    )

    expect(calls).toEqual([])
  })

  // Prevents creating jobs nobody in JobNimbus owns.
  test('fails without creating a job when the owner is not a JobNimbus user', async () => {
    const { client, jobs } = fakeJobNimbus({ users: [{ id: 'user-2', email: 'other@example.test' }] })
    const { terros } = fakeTerros()

    await expect(sendAccount(account('Damage Found'), config, client, terros)).rejects.toThrow(/sales rep/)
    expect(jobs.size).toBe(0)
  })

  // A failed (or silently dropped) externalLeadId save made the retry, and every later change, create another job.
  test('a retry after the Terros link failed updates the job it created instead of creating a second one', async () => {
    const { client, jobs } = fakeJobNimbus({ users })
    const failing = fakeTerros('error')

    await expect(sendAccount(account('Damage Found'), config, client, failing.terros)).rejects.toThrow(/externalId/)
    const { terros, updates } = fakeTerros()
    await sendAccount(account('Damage Found'), config, client, terros)

    expect([...jobs.keys()]).toEqual(['jn-1'])
    expect(jobs.get('jn-1')).toMatchObject({ status_name: 'Lead' })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'jn-1' } }])
  })

  // Deleting a job in JobNimbus only archives it; linking back to it hid the rep's lead on a job nobody can see.
  test('creates a new job instead of linking an archived one', async () => {
    const archived = { jnid: 'jn-archived', external_id: 'Account.example', is_active: false }
    const { client, jobs } = fakeJobNimbus({ users, jobs: [archived] })
    const { terros, updates } = fakeTerros()

    await sendAccount(account('Damage Found'), config, client, terros)

    expect(jobs.get('jn-1')).toMatchObject({ external_id: 'Account.example', is_active: true })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'jn-1' } }])
  })

  // The saved link skips the lookup, so a linked account kept updating its archived job.
  test('a linked account whose job was archived gets a new job, but only at a mapped stage', async () => {
    const archived = { jnid: 'jn-archived', external_id: 'Account.example', is_active: false }
    const { client, jobs } = fakeJobNimbus({ users, jobs: [archived] })
    const { terros, updates } = fakeTerros()

    await sendAccount(account('Knock', { externalLeadId: 'jn-archived' }), config, client, terros)
    expect(jobs.size).toBe(1)

    await sendAccount(account('Damage Found', { externalLeadId: 'jn-archived' }), config, client, terros)
    expect(jobs.get('jn-1')).toMatchObject({ external_id: 'Account.example', is_active: true, status_name: 'Lead' })
    expect(updates).toEqual([{ account: { accountId: 'Account.example', externalLeadId: 'jn-1' } }])
  })

  // Prevents a rate-limited create from failing the delivery when JobNimbus would accept it moments later.
  test('a create rate limited once is retried and creates one job', async () => {
    const { client, jobs, slept } = fakeJobNimbus({ users, fail: { 'POST /jobs': [{ status: 429 }] } })
    const { terros } = fakeTerros()

    await sendAccount(account('Damage Found'), config, client, terros)

    expect(jobs.size).toBe(1)
    expect(slept).toEqual([1000])
  })

  describe('primary contact', () => {
    const contactConfig = { ...config, contactType: 'Homeowner', contactStatus: 'Active' }

    // A job has no phone or email, so without a linked contact they never reached JobNimbus.
    test('creates a contact with the resident details and links it as the job primary', async () => {
      const { client, jobs, contacts } = fakeJobNimbus({ users })
      const { terros } = fakeTerros()

      await sendAccount(account('Damage Found'), contactConfig, client, terros)

      expect([...contacts.values()]).toEqual([
        expect.objectContaining({
          jnid: 'jn-1',
          external_id: 'Account.example',
          email: 'quinn@example.test',
          home_phone: '5550100',
          record_type_name: 'Homeowner',
          status_name: 'Active',
        }),
      ])
      expect(jobs.get('jn-2')).toMatchObject({ primary: { id: 'jn-1' }, record_type_name: 'Insurance' })
    })

    // A retry or a later change must update the contact it made, not add another.
    test('later sends update the same contact', async () => {
      const { client, contacts, calls } = fakeJobNimbus({ users })
      const { terros } = fakeTerros()

      await sendAccount(account('Damage Found'), contactConfig, client, terros)
      const newPhone = { ...account('Damage Found').resident, phone: '5550199' }
      await sendAccount(
        account('Damage Found', { externalLeadId: 'jn-2', resident: newPhone }),
        contactConfig,
        client,
        terros
      )

      expect(contacts.size).toBe(1)
      expect(contacts.get('jn-1')).toMatchObject({ home_phone: '5550199', status_name: 'Active' })
      expect(calls.find((call) => call.method === 'PUT' && call.path === '/contacts/jn-1')?.body).not.toHaveProperty(
        'status_name'
      )
    })

    // Upgrading an install that never set up contacts must not start creating them, and JobNimbus rejects a new
    // contact without a status, which would have blocked the job.
    test('creates no contact unless the install sets a contact type and status', async () => {
      const { client, jobs, calls } = fakeJobNimbus({ users })
      const { terros } = fakeTerros()

      await sendAccount(account('Damage Found'), config, client, terros)
      await sendAccount(account('Damage Found'), { ...config, contactType: 'Homeowner' }, client, terros)

      expect(calls.some((call) => call.path.startsWith('/contacts'))).toBe(false)
      expect(jobs.size).toBe(1)
    })

    // A rejected contact (e.g. a contact type JobNimbus doesn't know) must not keep the job out of JobNimbus.
    test('a rejected contact still sends the job, and the next send links one', async () => {
      const { client, jobs, contacts } = fakeJobNimbus({ users, fail: { 'POST /contacts': [{ status: 400 }] } })
      const { terros } = fakeTerros()

      await sendAccount(account('Damage Found'), contactConfig, client, terros)
      expect(jobs.get('jn-1')).not.toHaveProperty('primary')

      await sendAccount(account('Damage Found', { externalLeadId: 'jn-1' }), contactConfig, client, terros)
      expect(contacts.size).toBe(1)
      expect(jobs.get('jn-1')).toMatchObject({ primary: { id: 'jn-2' } })
    })
  })
})

describe('getAccountToSend', () => {
  // A JobNimbus webhook posted to this script's slug failed every run as "Missing account data", which says nothing
  // about the wrong slug; a silent skip instead would hide it from the run failure count.
  test('fails a JobNimbus webhook body as a permanent wrong-slug error that names its fields only', () => {
    const jobNimbusBody = { jnid: 'jn-job', type: 'job', name: 'Quinn Example', status_name: 'Lead' }

    expect(() => getAccountToSend(jobNimbusBody)).toThrow(
      expect.objectContaining({
        name: 'PermanentError',
        message:
          'Not a Terros Account webhook (fields: jnid, type, name, status_name). It probably reached the outgoing ' +
          'JobNimbus Send script through the wrong slug: JobNimbus webhooks belong at the incoming JobNimbus Webhook script.',
      })
    )
  })

  // Prevents a remove, which carries only the account id, from failing a run or being sent to JobNimbus.
  test('skips an Account remove and sends an add or update', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const data = account('Damage Found')

    expect(getAccountToSend({ entity: 'Account', action: 'remove', data: data.id })).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Skipping JobNimbus send: an Account remove has no account to send')
    expect(getAccountToSend({ entity: 'Account', action: 'update', data })).toBe(data)
  })
})
