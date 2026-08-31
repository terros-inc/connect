import { resolveCalendarRoute, resolveIncomingTeamRoute, resolveStageName, resolveTeamRoute } from './config.ts'

describe('GoHighLevel config', () => {
  const teamId = 'Team.example' as const

  test('resolves an outgoing team route', () => {
    const config = {
      teamLocations: { [teamId]: 'location-1' },
      teamPipelines: { [teamId]: 'pipeline-1' },
    }

    expect(resolveTeamRoute(config, teamId)).toEqual({
      teamId,
      locationId: 'location-1',
      pipelineId: 'pipeline-1',
    })
  })

  test('rejects an incomplete outgoing route', () => {
    const config = { teamLocations: { [teamId]: 'location-1' }, teamPipelines: {} }

    expect(() => resolveTeamRoute(config, teamId)).toThrow('Missing teamPipelines mapping')
  })

  test('resolves a calendar route for a team', () => {
    const config = {
      teamLocations: { [teamId]: 'location-1' },
      teamCalendars: { [teamId]: 'calendar-1' },
    }

    expect(resolveCalendarRoute(config, teamId)).toEqual({
      teamId,
      locationId: 'location-1',
      calendarId: 'calendar-1',
    })
  })

  test('reverse resolves a unique incoming route', () => {
    const config = {
      teamLocations: { [teamId]: 'location-1' },
      teamPipelines: { [teamId]: 'pipeline-1' },
    }

    expect(resolveIncomingTeamRoute(config, 'location-1', 'pipeline-1')).toEqual({
      teamId,
      locationId: 'location-1',
      pipelineId: 'pipeline-1',
    })
  })

  test('rejects duplicate incoming routes', () => {
    const config = {
      teamLocations: { 'Team.one': 'location-1', 'Team.two': 'location-1' },
      teamPipelines: { 'Team.one': 'pipeline-1', 'Team.two': 'pipeline-1' },
    }

    expect(() => resolveIncomingTeamRoute(config, 'location-1', 'pipeline-1')).toThrow('Multiple Terros teams map')
  })

  test('trims a stage name', () => {
    expect(resolveStageName(' Appointment Set ')).toBe('Appointment Set')
  })
})
