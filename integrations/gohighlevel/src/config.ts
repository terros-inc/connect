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
