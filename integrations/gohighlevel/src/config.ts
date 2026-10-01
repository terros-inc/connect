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

const offValues = ['', 'false', 'no', 'off', '0']
const onValues = ['true', 'yes', 'on', '1']

/**
 * Config switches arrive as text from the install form. Blank or false is off, true is on, and any other text is
 * treated as on and logged: for disabled that means doing nothing and for dryRun writing nothing, so a typo can only
 * make a script more cautious, never write when the installer meant it to hold back.
 */
export function isSwitchOn(name: 'disabled' | 'dryRun', value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value
  const text = (value ?? '').trim().toLowerCase()
  if (offValues.includes(text)) return false
  if (!onValues.includes(text))
    console.error(`Config ${name} is "${value}", expected true or false; treating it as true`)
  return true
}

export type RunSwitches = {
  /** Kill switch: when on the script does nothing. Checked before anything else. */
  disabled?: string | boolean
  /** When on the script reads and logs what it would write, and writes nothing. */
  dryRun?: string | boolean
}
