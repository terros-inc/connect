import { parseScriptConfig, resolveIncomingTeamRoute, resolveStageName, resolveTeamRoute } from './config.ts'

describe('GoHighLevel config', () => {
  const teamId = 'Team.example' as const

  test('resolves an outgoing team route', () => {
    const config = parseScriptConfig({
      teamLocations: { [teamId]: 'location-1' },
      teamPipelines: { [teamId]: 'pipeline-1' },
    })

    expect(resolveTeamRoute(config, teamId)).toEqual({
      teamId,
      locationId: 'location-1',
      pipelineId: 'pipeline-1',
    })
  })

  test('rejects an incomplete outgoing route', () => {
    const config = parseScriptConfig({ teamLocations: { [teamId]: 'location-1' } })

    expect(() => resolveTeamRoute(config, teamId)).toThrow('Missing teamPipelines mapping')
  })

  test('reverse resolves a unique incoming route', () => {
    const config = parseScriptConfig({
      teamLocations: { [teamId]: 'location-1' },
      teamPipelines: { [teamId]: 'pipeline-1' },
      teamWorkflows: { [teamId]: 'WF.example' },
    })

    expect(resolveIncomingTeamRoute(config, 'location-1', 'pipeline-1')).toEqual({
      teamId,
      locationId: 'location-1',
      pipelineId: 'pipeline-1',
      workflowId: 'WF.example',
    })
  })

  test('rejects duplicate incoming routes', () => {
    const config = parseScriptConfig({
      teamLocations: { 'Team.one': 'location-1', 'Team.two': 'location-1' },
      teamPipelines: { 'Team.one': 'pipeline-1', 'Team.two': 'pipeline-1' },
      teamWorkflows: { 'Team.one': 'WF.one', 'Team.two': 'WF.two' },
    })

    expect(() => resolveIncomingTeamRoute(config, 'location-1', 'pipeline-1')).toThrow('Multiple Terros teams map')
  })

  test('trims a stage name', () => {
    expect(resolveStageName(' Appointment Set ')).toBe('Appointment Set')
  })
})
