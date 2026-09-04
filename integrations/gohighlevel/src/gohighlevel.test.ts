import {
  findPipelineStage,
  getPipelineStageName,
  opportunityNeedsUpdate,
  type GoHighLevelOpportunity,
  type GoHighLevelPipeline,
  updateOpportunityStage,
} from './gohighlevel.ts'

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

  test('resolves an inbound stage ID to its name', () => {
    expect(getPipelineStageName(pipeline, 'stage-1')).toBe('Lead')
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
