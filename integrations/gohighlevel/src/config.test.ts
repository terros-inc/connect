import { resolveCalendarRoute, resolveStageName, resolveTeamRoute, validateIncomingTeamRoute } from './config.ts'

describe('GoHighLevel config', () => {
  const teamId = 'Team.example' as const
  const team = { teamId, name: 'Example', externalId: 'location-1', level: 1 }

  test('resolves an outgoing team route', () => {
    const config = {
      teamPipelines: { [teamId]: 'pipeline-1' },
    }

    expect(resolveTeamRoute(config, team)).toEqual({
      teamId,
      locationId: 'location-1',
      pipelineId: 'pipeline-1',
    })
  })

  test('rejects an incomplete outgoing route', () => {
    const config = { teamPipelines: {} }

    expect(() => resolveTeamRoute(config, team)).toThrow('Missing teamPipelines mapping')
  })

  test('resolves a calendar route for a team', () => {
    const config = {
      teamCalendars: { [teamId]: 'calendar-1' },
    }

    expect(resolveCalendarRoute(config, team)).toEqual({
      teamId,
      locationId: 'location-1',
      calendarId: 'calendar-1',
    })
  })

  test('validates a matching incoming route', () => {
    const config = {
      teamPipelines: { [teamId]: 'pipeline-1' },
    }

    expect(() => validateIncomingTeamRoute(config, team, 'location-1', 'pipeline-1')).not.toThrow()
  })

  test('rejects an incoming route that does not match the account team', () => {
    const config = {
      teamPipelines: { [teamId]: 'pipeline-1' },
    }

    expect(() => validateIncomingTeamRoute(config, team, 'location-2', 'pipeline-1')).toThrow(
      'do not match Terros team'
    )
  })

  test('trims a stage name', () => {
    expect(resolveStageName(' Appointment Set ')).toBe('Appointment Set')
  })
})
