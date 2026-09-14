import {
  findPipelineStage,
  opportunityNeedsUpdate,
  toContactInput,
  toOpportunityInput,
  type GoHighLevelOpportunity,
  type GoHighLevelPipeline,
  updateOpportunityStage,
} from './gohighlevel.ts'

describe('GoHighLevel contacts', () => {
  test('builds a contact from account data', () => {
    const account = {
      address: {
        line1: '123 Main St',
        locality: 'Victoria',
        countrySubd: 'BC',
        postal1: 'V8V 1V1',
        latlng: {
          latitude: 48.4284,
          longitude: -123.3656,
        },
      },
      resident: {
        firstName: ' Quinn ',
        lastName: ' Example ',
        email: ' quinn@example.com ',
        phone: ' 555-0100 ',
      },
    }

    expect(toContactInput(account, 'ghl-location', undefined, 'ghl-user')).toEqual({
      locationId: 'ghl-location',
      firstName: 'Quinn',
      lastName: 'Example',
      name: undefined,
      email: 'quinn@example.com',
      phone: '555-0100',
      address1: '123 Main St',
      city: 'Victoria',
      state: 'BC',
      postalCode: 'V8V 1V1',
      assignedTo: 'ghl-user',
      source: 'Terros',
      customFields: [],
    })
  })
})

describe('GoHighLevel pipeline stages', () => {
  const pipeline: GoHighLevelPipeline = {
    id: 'pipeline-1',
    locationId: 'location-1',
    stages: [
      { id: 'stage-1', name: 'Lead' },
      { id: 'stage-2', name: 'Appointment Set' },
    ],
  }

  test('matches an outbound stage name case-insensitively', () => {
    expect(findPipelineStage(pipeline, ' appointment SET ')).toEqual({ id: 'stage-2', name: 'Appointment Set' })
  })

  test('rejects a missing stage', () => {
    expect(() => findPipelineStage(pipeline, 'Installed')).toThrow('Expected one stage named')
  })
})

describe('GoHighLevel opportunities', () => {
  const opportunity: GoHighLevelOpportunity = {
    id: 'opportunity-1',
    contactId: 'contact-1',
    locationId: 'location-1',
    pipelineId: 'pipeline-1',
    pipelineStageId: 'stage-1',
    name: 'Jane Homeowner',
    assignedTo: 'user-1',
  }

  test('builds an opportunity for an outgoing account', () => {
    const account = {
      accountId: 'Account.example',
      resident: {
        firstName: 'Quinn',
        lastName: 'Example',
      },
    }
    const route = {
      locationId: 'ghl-location',
      pipelineId: 'ghl-pipeline',
    }

    expect(toOpportunityInput(account, route, 'ghl-contact', 'ghl-stage', 'ghl-user')).toEqual({
      locationId: 'ghl-location',
      pipelineId: 'ghl-pipeline',
      pipelineStageId: 'ghl-stage',
      contactId: 'ghl-contact',
      name: 'Quinn Example',
      status: 'open',
      assignedTo: 'ghl-user',
    })
  })

  test('updates when the name changes without a stage change', () => {
    expect(
      opportunityNeedsUpdate(opportunity, {
        pipelineStageId: 'stage-1',
        name: 'Jane Customer',
        assignedTo: 'user-1',
      })
    ).toBe(true)
  })

  test('updates when the owner changes without a stage change', () => {
    expect(
      opportunityNeedsUpdate(opportunity, {
        pipelineStageId: 'stage-1',
        name: 'Jane Homeowner',
        assignedTo: 'user-2',
      })
    ).toBe(true)
  })

  test('skips an unchanged opportunity', () => {
    expect(
      opportunityNeedsUpdate(opportunity, {
        pipelineStageId: 'stage-1',
        name: 'Jane Homeowner',
        assignedTo: 'user-1',
      })
    ).toBe(false)
  })

  test('updates only the opportunity stage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ opportunity: { ...opportunity, pipelineStageId: 'stage-2' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await updateOpportunityStage('token', opportunity.id, { pipelineStageId: 'stage-2' })

    const request = fetchMock.mock.calls[0]
    expect(request?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ pipelineStageId: 'stage-2' }),
    })
    fetchMock.mockRestore()
  })
})
