import { receiveWebhook } from './incoming.ts'
import { fakeJobNimbus, fakeTerros } from './fakeJobNimbus.ts'

const job = {
  jnid: 'jn-job',
  external_id: 'Account.example',
  name: 'Quinn Example',
  status_name: 'Lead',
  date_status_change: 1767225600,
  address_line1: '123 Main St',
  city: 'Springfield',
  state_text: 'IL',
  zip: '62701',
  owners: [{ id: 'user-1' }],
}
const users = [{ id: 'user-1', email: 'rep@example.test' }]
const config = { workflowId: 'WF.example' }

describe('receiveWebhook', () => {
  // Prevents a status change from landing on the wrong account, with the wrong owner, or with the arrival time.
  test("moves the linked account to the job's status in JobNimbus", async () => {
    const { client } = fakeJobNimbus({ jobs: [job], users })
    const { terros, upserts } = fakeTerros()

    await receiveWebhook({ jnid: 'jn-job', status_name: 'Lead' }, config, client, terros)

    expect(upserts).toEqual([
      {
        requestType: 'upsert',
        account: expect.objectContaining({
          accountId: 'Account.example',
          workflowTarget: 'Lead',
          sourceStatus: 'Lead',
          externalLeadId: 'jn-job',
          lastActionDate: 1767225600000,
          actorId: 'rep@example.test',
          owner: { email: 'rep@example.test' },
          resident: { name: 'Quinn Example' },
          location: { line1: '123 Main St', locality: 'Springfield', countrySubd: 'IL', postal1: '62701' },
        }),
      },
    ])
  })

  // Prevents a forged POST to the webhook URL from moving, renaming, reassigning or creating accounts: the body
  // carries no weight beyond the jnid, and a jnid this key cannot read changes nothing.
  test('uses only what JobNimbus reports, and ignores a jnid it does not know', async () => {
    const { client } = fakeJobNimbus({ jobs: [job], users })
    const { terros, upserts } = fakeTerros()

    const forged = {
      jnid: 'jn-job',
      status_name: 'Signed Contract',
      external_id: 'Account.other',
      name: 'Forged Name',
      address_line1: '1 Forged St',
      owners: [{ email: 'attacker@example.test' }],
    }
    await receiveWebhook(forged, config, client, terros)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      account: {
        accountId: 'Account.example',
        workflowTarget: 'Lead',
        sourceStatus: 'Lead',
        resident: { name: 'Quinn Example' },
        location: { line1: '123 Main St' },
        owner: { email: 'rep@example.test' },
      },
    })

    await receiveWebhook({ ...forged, jnid: 'jn-made-up' }, config, client, terros)
    expect(upserts).toHaveLength(1)
  })

  // Prevents an expired key from looking like an unknown job and silently dropping every real status change.
  test('fails a delivery loudly when JobNimbus rejects the key', async () => {
    const { client } = fakeJobNimbus({ jobs: [job], fail: { 'GET /jobs/jn-job': [{ status: 403 }] } })
    const { terros, upserts } = fakeTerros()

    await expect(receiveWebhook({ jnid: 'jn-job' }, config, client, terros)).rejects.toThrow(
      /rejected this install's API key \(403\).*expired/
    )
    expect(upserts).toEqual([])
  })
})
