import {
  resolveCalendarRoute,
  resolveGoHighLevelStageName,
  resolveTeamRoute,
  resolveTerrosStageName,
  validateIncomingTeamLocation,
} from './config.ts'

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

  test('validates a matching incoming location', () => {
    expect(() => validateIncomingTeamLocation(team, 'location-1')).not.toThrow()
  })

  test('rejects an incoming location that does not match the account team', () => {
    expect(() => validateIncomingTeamLocation(team, 'location-2')).toThrow('does not match Terros team')
  })

  test('maps a Terros stage to a GoHighLevel stage', () => {
    expect(resolveGoHighLevelStageName(' Activity ', { activity: 'Lead' })).toBe('Lead')
  })

  test('maps a GoHighLevel stage back to a Terros stage', () => {
    expect(resolveTerrosStageName(' lead ', { Activity: 'Lead' })).toBe('Activity')
  })

  test('uses the same trimmed stage name when no mapping is configured', () => {
    expect(resolveGoHighLevelStageName(' Appointment Set ')).toBe('Appointment Set')
    expect(resolveTerrosStageName(' Appointment Set ')).toBe('Appointment Set')
  })
})
