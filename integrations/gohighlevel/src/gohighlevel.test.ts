import { findPipelineStage, getPipelineStageName, type GoHighLevelPipeline } from './gohighlevel.ts'

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
