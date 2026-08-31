import type { TeamId, WorkflowId } from '@terros-inc/sdk'

export type TeamRoute = {
  teamId: TeamId
  locationId: string
  pipelineId: string
}

export type IncomingTeamRoute = TeamRoute & {
  workflowId: WorkflowId
}

export type CalendarRoute = {
  teamId: TeamId
  locationId: string
  calendarId: string
}

export function resolveTeamRoute(
  config: { teamLocations: Record<string, string>; teamPipelines: Record<string, string> },
  teamId: TeamId
): TeamRoute {
  const locationId = config.teamLocations[teamId]
  const pipelineId = config.teamPipelines[teamId]

  if (!locationId) throw Error(`Missing teamLocations mapping for team ${teamId}`)
  if (!pipelineId) throw Error(`Missing teamPipelines mapping for team ${teamId}`)

  return { teamId, locationId, pipelineId }
}

export function resolveIncomingTeamRoute(
  config: {
    teamLocations: Record<string, string>
    teamPipelines: Record<string, string>
    teamWorkflows: Record<string, string>
  },
  locationId: string,
  pipelineId: string
): IncomingTeamRoute | undefined {
  const matchingTeamIds = Object.entries(config.teamLocations)
    .filter(([, configuredLocationId]) => configuredLocationId === locationId)
    .map(([teamId]) => teamId)
    .filter((teamId) => config.teamPipelines[teamId] === pipelineId)

  if (matchingTeamIds.length > 1) {
    throw Error(`Multiple Terros teams map to GoHighLevel location ${locationId} and pipeline ${pipelineId}`)
  }

  const teamId = matchingTeamIds[0]
  if (!teamId) return
  if (!isTeamId(teamId)) throw Error(`Invalid Terros team ID in routing config: ${teamId}`)

  const workflowId = config.teamWorkflows[teamId]
  if (!workflowId) throw Error(`Missing teamWorkflows mapping for team ${teamId}`)
  if (!isWorkflowId(workflowId)) throw Error(`Invalid Terros workflow ID in routing config: ${workflowId}`)

  return { teamId, locationId, pipelineId, workflowId }
}

export function resolveCalendarRoute(
  config: { teamLocations: Record<string, string>; teamCalendars: Record<string, string> },
  teamId: TeamId
): CalendarRoute {
  const locationId = config.teamLocations[teamId]
  const calendarId = config.teamCalendars[teamId]

  if (!locationId) throw Error(`Missing teamLocations mapping for team ${teamId}`)
  if (!calendarId) throw Error(`Missing teamCalendars mapping for team ${teamId}`)

  return { teamId, locationId, calendarId }
}

export function resolveStageName(sourceStageName: string): string {
  return sourceStageName.trim()
}

function isTeamId(value: string): value is TeamId {
  return value.startsWith('Team:') || value.startsWith('Team.')
}

function isWorkflowId(value: string): value is WorkflowId {
  return value.startsWith('WF.')
}
