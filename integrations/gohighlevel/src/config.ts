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

export function hasTerrosStageMapping(goHighLevelStageName: string, stageMappings?: Record<string, string>): boolean {
  const normalizedGoHighLevelStageName = goHighLevelStageName.trim().toLowerCase()
  return Object.values(stageMappings ?? {}).some(
    (configuredGoHighLevelStageName) =>
      configuredGoHighLevelStageName.trim().toLowerCase() === normalizedGoHighLevelStageName
  )
}

/** Config booleans arrive as strings from the install form, so accept both. */
export function isOn(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value
  return ['true', 'yes', 'on', '1'].includes((value ?? '').trim().toLowerCase())
}

export type RunSwitches = {
  /** Kill switch: when on the script does nothing. Checked before anything else. */
  disabled?: string | boolean
  /** When on the script reads and logs what it would write, and writes nothing. */
  dryRun?: string | boolean
}
