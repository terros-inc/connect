import type { TeamId, TinyTeam } from '@terros-inc/sdk'

export type TeamRoute = {
  teamId: TeamId
  locationId: string
  pipelineId: string
}

export type CalendarRoute = {
  teamId: TeamId
  locationId: string
  calendarId: string
}

export function resolveTeamRoute(config: { teamPipelines: Record<string, string> }, team: TinyTeam): TeamRoute {
  const locationId = team.externalId
  const pipelineId = config.teamPipelines[team.teamId]

  if (!locationId) throw Error(`Terros team ${team.teamId} has no GoHighLevel location ID`)
  if (!pipelineId) throw Error(`Missing teamPipelines mapping for team ${team.teamId}`)

  return { teamId: team.teamId, locationId, pipelineId }
}

export function validateIncomingTeamLocation(team: TinyTeam, locationId: string): void {
  if (!team.externalId) throw Error(`Terros team ${team.teamId} has no GoHighLevel location ID`)
  if (team.externalId !== locationId) {
    throw Error(`GoHighLevel location ${locationId} does not match Terros team ${team.teamId}`)
  }
}

export function resolveCalendarRoute(config: { teamCalendars: Record<string, string> }, team: TinyTeam): CalendarRoute {
  const locationId = team.externalId
  const calendarId = config.teamCalendars[team.teamId]

  if (!locationId) throw Error(`Terros team ${team.teamId} has no GoHighLevel location ID`)
  if (!calendarId) throw Error(`Missing teamCalendars mapping for team ${team.teamId}`)

  return { teamId: team.teamId, locationId, calendarId }
}

export function resolveGoHighLevelStageName(terrosStageName: string, stageMappings?: Record<string, string>): string {
  const normalizedTerrosStageName = terrosStageName.trim().toLowerCase()
  const stageMapping = Object.entries(stageMappings ?? {}).find(
    ([configuredTerrosStageName]) => configuredTerrosStageName.trim().toLowerCase() === normalizedTerrosStageName
  )
  const [, configuredGoHighLevelStageName] = stageMapping ?? []

  return (configuredGoHighLevelStageName ?? terrosStageName).trim()
}

export function resolveTerrosStageName(goHighLevelStageName: string, stageMappings?: Record<string, string>): string {
  const normalizedGoHighLevelStageName = goHighLevelStageName.trim().toLowerCase()
  const stageMapping = Object.entries(stageMappings ?? {}).find(
    ([, configuredGoHighLevelStageName]) =>
      configuredGoHighLevelStageName.trim().toLowerCase() === normalizedGoHighLevelStageName
  )
  const [configuredTerrosStageName] = stageMapping ?? []

  return (configuredTerrosStageName ?? goHighLevelStageName).trim()
}
