export function toGhlStage(terrosStageName: string, stageMappings?: Record<string, string>): string {
  const normalizedTerrosStageName = terrosStageName.trim().toLowerCase()
  const stageMapping = Object.entries(stageMappings ?? {}).find(
    ([configuredTerrosStageName]) => configuredTerrosStageName.trim().toLowerCase() === normalizedTerrosStageName
  )
  const [, configuredGoHighLevelStageName] = stageMapping ?? []

  return (configuredGoHighLevelStageName ?? terrosStageName).trim()
}

export function toTerrosStage(goHighLevelStageName: string, stageMappings?: Record<string, string>): string {
  const normalizedGoHighLevelStageName = goHighLevelStageName.trim().toLowerCase()
  const stageMapping = Object.entries(stageMappings ?? {}).find(
    ([, configuredGoHighLevelStageName]) =>
      configuredGoHighLevelStageName.trim().toLowerCase() === normalizedGoHighLevelStageName
  )
  const [configuredTerrosStageName] = stageMapping ?? []

  return (configuredTerrosStageName ?? goHighLevelStageName).trim()
}
