import type { TeamId, WorkflowId } from '@terros-inc/sdk'

export type ScriptConfig = {
  teamLocations: Record<string, string>
  teamPipelines: Record<string, string>
  teamWorkflows: Record<string, string>
  userMappings: Record<string, string>
  contactFieldMappings: Record<string, string>
}

export type TeamRoute = {
  teamId: TeamId
  locationId: string
  pipelineId: string
}

export type IncomingTeamRoute = TeamRoute & {
  workflowId: WorkflowId
}

export function parseScriptConfig(value: unknown): ScriptConfig {
  const config = isRecord(value) ? value : {}
  return {
    teamLocations: readMapping(config.teamLocations),
    teamPipelines: readMapping(config.teamPipelines),
    teamWorkflows: readMapping(config.teamWorkflows),
    userMappings: readMapping(config.userMappings),
    contactFieldMappings: readMapping(config.contactFieldMappings),
  }
}

// seriously considering adding nested objects to the mapping schema, just for this. just noting that this might be greatly simplified/removed in the future
export function resolveTeamRoute(config: ScriptConfig, teamId: TeamId): TeamRoute {
  const locationId = config.teamLocations[teamId]
  const pipelineId = config.teamPipelines[teamId]

  if (!locationId) throw Error(`Missing teamLocations mapping for team ${teamId}`)
  if (!pipelineId) throw Error(`Missing teamPipelines mapping for team ${teamId}`)

  return { teamId, locationId, pipelineId }
}

export function resolveIncomingTeamRoute(
  config: ScriptConfig,
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

export function resolveStageName(sourceStageName: string): string {
  return sourceStageName.trim()
}

// this function should be entirely unnecessary because config is enforced from the install, I see no purpose in keeping something that will only make bad configs fail quieter
function readMapping(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTeamId(value: string): value is TeamId {
  return value.startsWith('Team:') || value.startsWith('Team.')
}

function isWorkflowId(value: string): value is WorkflowId {
  return value.startsWith('WF.')
}
