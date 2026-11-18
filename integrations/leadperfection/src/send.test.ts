import type { AccountId, AccountWebhookData } from '@terros-inc/sdk'
import { sendAccount, type SendConfig } from './send.ts'
import { fakeLeadPerfection, fakeTerros } from './fakeLeadPerfection.ts'

const accountId = 'Account.example1' as AccountId
const config: SendConfig = { sendStageIds: 'S.leadSet, S.other', srs_id: '56', sender: 'Acme Remodeling' }
// 2026-12-01 19:30 UTC is 2:30 PM in New York.
const appointmentDate = Date.parse('2026-12-01T19:30:00Z')

function account(overrides: Partial<AccountWebhookData> = {}): AccountWebhookData {
  return {
    id: accountId,
    createdAt: '2026-11-18T15:00:00Z',
    updatedAt: '2026-11-18T15:00:00Z',
    workflowState: { workflowId: 'WF.example', stageId: 'S.leadSet', stageName: 'Lead (Set)' },
    resident: { firstName: 'Pat', lastName: 'Example', phone: '5555550100', email: 'user@example.test' },
    address: {
      line1: '1234 NORTH EXAMPLE BOULEVARD EAST, BUILDING 7',
      locality: 'SPRINGFIELD',
      countrySubd: 'nc',
      postal1: '27519-1234',
    } as AccountWebhookData['address'],
    owner: {
      userId: 'U.example',
      firstName: 'Sam',
      lastName: 'Setter',
      email: 'setter@example.test',
      clientUserId: '478',
      timeZone: 'America/New_York',
    },
    closer: { userId: 'U.example2', firstName: 'Cy', lastName: 'Closer', email: 'closer@example.test' },
    note: 'Gate code is on the door',
    ...overrides,
  }
}

async function send(data: AccountWebhookData, stored: object = {}, sendConfig = config) {
  const lp = fakeLeadPerfection()
  const terros = fakeTerros([{ accountId, appointmentDate, ...stored }])
  await sendAccount(data, sendConfig, lp.client, terros.terros)
  return { lp, ...terros }
}

describe('LeadPerfection Send', () => {
  // Field-by-field mapping from the old integration, within the docs' LeadAdd limits.
  it('sends one LeadAdd with the mapped fields and saves the lead ID', async () => {
    const { lp, writes } = await send(account())

    expect(lp.added).toEqual([
      {
        firstname: 'Pat',
        lastname: 'Example',
        address1: '1234 North Example Boulevard East, Build',
        city: 'Springfield',
        state: 'NC',
        zip: '27519',
        phone: '5555550100',
        email: 'user@example.test',
        user1: 'setter@example.test',
        user2: 'closer@example.test',
        notes: 'Gate code is on the door',
        lognumber: accountId,
        pro_id: '478',
        sender: 'Acme Remodeling',
        srs_id: '56',
        apptdate: '12/01/2026',
        appttime: '02:30PM',
      },
    ])
    expect(writes).toEqual([{ route: 'account/update', input: { account: { accountId, externalLeadId: '2901' } } }])
  })

  it('sends a Canadian postal code whole, the configured product and market, and no non-numeric pro_id', async () => {
    const data = account({
      address: {
        line1: '1 Example St',
        locality: 'Toronto',
        countrySubd: 'ON',
        postal1: 'm5v 2t6',
      } as AccountWebhookData['address'],
      owner: { ...account().owner!, clientUserId: 'rep-7' },
    })

    const { lp } = await send(data, {}, { ...config, productID: 'Windows', brn_id: 'North' })

    expect(lp.added[0]).toMatchObject({ zip: 'M5V 2T6', productID: 'Windows', brn_id: 'North' })
    expect(lp.added[0]).not.toHaveProperty('pro_id')
  })

  // apptdate and appttime are both sent or both left out; a guessed zone would book the wrong local time.
  it('sends the appointment in the configured zone, or none without a zone', async () => {
    const chicago = await send(account(), {}, { ...config, timeZone: 'America/Chicago' })
    expect(chicago.lp.added[0]).toMatchObject({ apptdate: '12/01/2026', appttime: '01:30PM' })

    const noZone = await send(account({ owner: { ...account().owner!, timeZone: undefined } }))
    expect(noZone.lp.added[0]).not.toHaveProperty('apptdate')
    expect(noZone.lp.added[0]).not.toHaveProperty('appttime')
  })

  it.each([
    ['a stage that does not send', account({ workflowState: { workflowId: 'WF.example', stageId: 'S.sit' } }), {}],
    ['an account the webhook shows as sent', account({ externalLeadId: '2001' }), {}],
    ['an account another delivery already linked', account(), { externalLeadId: '2001' }],
    ['an account that came from LeadPerfection', account(), { accountSource: 'LeadPerfection' }],
    ['a resident without a last name', account({ resident: { firstName: 'Pat' } }), {}],
  ])('never sends %s', async (_, data, stored) => {
    const { lp, writes } = await send(data, stored)

    expect(lp.added).toEqual([])
    expect(writes).toEqual([])
  })
})
