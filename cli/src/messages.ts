import type { EndpointParameter } from './crud/endpoint'

export const HELP_PARENT_MESSAGE = `
usage: terros <command> <subcommand> [parameters]
To see help text, you can run:

  terros help
  terros <command> help
  terros <command> <subcommand> help
`.trim()

export function formatCommandsHelp(commands: string[]): string {
  const lines = [
    `usage: terros <command> <subcommand> [parameters]`,
    '',
    'Commands:',
    ...commands.map((command) => `  ${command}`),
    '',
    `Run "terros <command> help" to see subcommands.`,
  ]

  return lines.join('\n')
}

export function formatSubcommandsHelp(command: string, subcommands: string[]): string {
  const lines = [
    `usage: terros ${command} <subcommand> [parameters]`,
    '',
    'Subcommands:',
    ...subcommands.map((subcommand) => `  ${subcommand}`),
    '',
    `Run "terros ${command} <subcommand> help" to see subcommand parameters.`,
  ]

  return lines.join('\n')
}

export function formatSubcommandParametersHelp(
  command: string,
  subcommand: string,
  parameters: EndpointParameter[]
): string {
  const lines = [`usage: terros ${command} ${subcommand} [parameters]`, '', 'Parameters:']

  if (parameters.length === 0) {
    lines.push('  none')
    return lines.join('\n')
  }

  const labelWidth = Math.max('type'.length, 'required'.length, 'description'.length)

  parameters.forEach((parameter, index) => {
    if (index > 0) lines.push('')
    lines.push(
      `  --${parameter.name}`,
      `    ${'type'.padEnd(labelWidth)}  ${parameter.type}`,
      `    ${'required'.padEnd(labelWidth)}  ${parameter.required ? 'yes' : 'no'}`
    )
    if (parameter.description) lines.push(`    ${'description'.padEnd(labelWidth)}  ${parameter.description}`)
  })

  return lines.join('\n')
}
