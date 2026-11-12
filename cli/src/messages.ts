import { getArrayItemTypes, getStringLiteralValues, type EndpointParameter } from '@terros-inc/mcp-core'
import { STAFF_IMPERSONATION_HELP } from './impersonation'

export const HELP_PARENT_MESSAGE = `
usage: terros <command> [<subcommand> ...] [parameters]
Commands follow the API endpoint path, so /garden/bed/list is "terros garden bed list".
To see help text, you can run:

  terros help
  terros <command> help
  terros <command> <subcommand> ... help
`.trim()

export function formatCommandsHelp(commands: string[]): string {
  const lines = [
    `usage: terros <command> [<subcommand> ...] [parameters]`,
    '',
    'Commands:',
    ...commands.map((command) => `  ${command}`),
    '',
    `Run "terros <command> help" to see subcommands.`,
    `Run "terros --version" to print the installed CLI version.`,
    '',
    STAFF_IMPERSONATION_HELP,
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
    `Run "terros ${command} <subcommand> help" to see its parameters or nested subcommands.`,
  ]

  return lines.join('\n')
}

export function formatCommandUsage(command: string): string {
  return [`usage: terros ${command} [parameters]`, '', `Run "terros ${command} help" to see its parameters.`].join('\n')
}

export function formatSubcommandParametersHelp(
  command: string,
  subcommand: string | undefined,
  parameters: EndpointParameter[],
  description?: string,
  showDepthHelp = false,
  subcommands: string[] = [],
  exampleArguments?: string[]
): string {
  const commandParts = [command]
  if (subcommand) commandParts.push(subcommand)
  const lines = [`usage: terros ${commandParts.join(' ')} [parameters]`, '']

  if (description) lines.push(description, '')

  lines.push('Parameters:')

  if (parameters.length === 0) {
    lines.push('  none')
  } else {
    const labelWidth = Math.max('type'.length, 'required'.length, 'description'.length)

    parameters.forEach((parameter, index) => {
      if (index > 0) lines.push('')
      lines.push(
        `  --${parameter.name}`,
        `    ${'type'.padEnd(labelWidth)}  ${parameter.type}`,
        `    ${'required'.padEnd(labelWidth)}  ${parameter.required ? 'yes' : 'no'}`
      )
      if (parameter.description) lines.push(`    ${'description'.padEnd(labelWidth)}  ${parameter.description}`)
      const array = getArrayParameterSyntax(parameter.type)
      if (array) {
        const examples = array.examples
        const syntax = array.structured
          ? `JSON array (shell-quoted): --${parameter.name} '[...]'`
          : `Comma-separated (${quoteShellArgument(examples.join(','))}), a shell-quoted JSON array, or a repeated flag (${examples.map((value) => formatFlagArgument(`--${parameter.name}`, value)).join(' ')})`
        lines.push(`    ${'syntax'.padEnd(labelWidth)}  ${syntax}`)
        if (array.allowed) lines.push(`    ${'allowed'.padEnd(labelWidth)}  ${array.allowed.join(', ')}`)
      }
    })
  }

  if (exampleArguments) {
    lines.push('', 'Example:', `  terros ${[...commandParts, ...exampleArguments.map(quoteShellArgument)].join(' ')}`)
  }

  if (showDepthHelp) {
    lines.push(
      '',
      `Use "--depth <number>" with help to show more nested object type detail, as in "terros ${commandParts.join(' ')} help --depth 2"; running the command does not accept it.`,
      `Pass an array as one shell-quoted JSON value, as in --ids '["id_1","id_2"]'.`,
      `Use "--inputFile <path>" to send a JSON request body from a file ("-" for stdin); flags override its fields.`
    )
  }

  if (subcommands.length > 0) {
    lines.push('', 'Subcommands:', ...subcommands.map((name) => `  ${name}`))
  }

  return lines.join('\n')
}

/** Quote an argument for a POSIX shell, leaving plain words such as `--size` and `100` bare. */
export function quoteShellArgument(argument: string): string {
  return /^[\w.,:@/+=-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`
}

export function formatFlagArgument(flag: string, value: string): string {
  return `${flag}${value.startsWith('-') ? '=' : ' '}${quoteShellArgument(value)}`
}

export function getArrayParameterSyntax(
  type: string
): { structured: boolean; allowed?: string[]; examples: string[] } | undefined {
  const items = getArrayItemTypes(type)
  if (!items) return undefined
  return {
    structured: !items.every(isScalarArrayItem),
    allowed: getStringLiteralValues(items.join(' | ')),
    examples: items.flatMap(scalarArrayExamples).slice(0, 2),
  }
}

function isScalarArrayItem(type: string): boolean {
  if (['string', 'integer', 'number', 'boolean', 'null'].includes(type)) return true
  try {
    const value: unknown = JSON.parse(type)
    return value === null || ['string', 'number', 'boolean'].includes(typeof value)
  } catch {
    return false
  }
}

function scalarArrayExamples(type: string): string[] {
  switch (type) {
    case 'string':
      return ['a', 'b']
    case 'integer':
    case 'number':
      return ['1', '2']
    case 'boolean':
      return ['true', 'false']
    case 'null':
      return ['null', 'null']
    default:
      try {
        const value: unknown = JSON.parse(type)
        return [String(value)]
      } catch {
        return []
      }
  }
}
