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

export function resolveIncomingTeamRoute(
  config: { teamPipelines: Record<string, string> },
  team: TinyTeam,
  locationId: string,
  pipelineId: string
): TeamRoute {
  const route = resolveTeamRoute(config, team)
  if (route.locationId !== locationId || route.pipelineId !== pipelineId) {
    throw Error(`GoHighLevel location ${locationId} and pipeline ${pipelineId} do not match Terros team ${team.teamId}`)
  }

  return route
}

export function resolveCalendarRoute(config: { teamCalendars: Record<string, string> }, team: TinyTeam): CalendarRoute {
  const locationId = team.externalId
  const calendarId = config.teamCalendars[team.teamId]

  if (!locationId) throw Error(`Terros team ${team.teamId} has no GoHighLevel location ID`)
  if (!calendarId) throw Error(`Missing teamCalendars mapping for team ${team.teamId}`)

  return { teamId: team.teamId, locationId, calendarId }
}

export function resolveStageName(sourceStageName: string): string {
  return sourceStageName.trim()
}
