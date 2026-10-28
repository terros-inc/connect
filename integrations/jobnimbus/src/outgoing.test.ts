import type { AccountWebhookData } from '@terros-inc/sdk'
import { sendAccount } from './outgoing.ts'
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

  // Prevents a rate-limited create from failing the delivery when JobNimbus would accept it moments later.
  test('a create rate limited once is retried and creates one job', async () => {
    const { client, jobs, slept } = fakeJobNimbus({ users, fail: { 'POST /jobs': [{ status: 429 }] } })
    const { terros } = fakeTerros()

    await sendAccount(account('Damage Found'), config, client, terros)

    expect(jobs.size).toBe(1)
    expect(slept).toEqual([1000])
  })
})
