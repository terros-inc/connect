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

const MAX_TYPE_LENGTH = 40

function truncateType(type: string): string {
  if (type.length <= MAX_TYPE_LENGTH) return type
  return `${type.slice(0, MAX_TYPE_LENGTH - 1)}…`
}

export function formatParameterHelp(command: string, subcommand: string, parameter: EndpointParameter): string {
  const labelWidth = Math.max('type'.length, 'required'.length, 'description'.length)
  const lines = [
    `usage: terros ${command} ${subcommand} --${parameter.name} <value>`,
    '',
    `--${parameter.name}`,
    `  ${'type'.padEnd(labelWidth)}  ${parameter.type}`,
    `  ${'required'.padEnd(labelWidth)}  ${parameter.required ? 'yes' : 'no'}`,
  ]

  if (parameter.description) lines.push(`  ${'description'.padEnd(labelWidth)}  ${parameter.description}`)

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

  const nameWidth = Math.max(...parameters.map((parameter) => parameter.name.length))
  const typeWidth = Math.max(...parameters.map((parameter) => truncateType(parameter.type).length))
  const requiredWidth = Math.max('required'.length, 'optional'.length)

  lines.push(
    ...parameters.map((parameter) => {
      const name = parameter.name.padEnd(nameWidth)
      const type = truncateType(parameter.type).padEnd(typeWidth)
      const required = (parameter.required ? 'required' : 'optional').padEnd(requiredWidth)
      const description = parameter.description ? `  ${parameter.description}` : ''
      return `  --${name}  ${type}  ${required}${description}`
    })
  )

  return lines.join('\n')
}
