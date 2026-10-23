import type { EndpointParameter } from '@terros-inc/mcp-core'

export const HELP_PARENT_MESSAGE = `
usage: terros <command> [<subcommand> ...] [parameters]
Commands follow the API endpoint path, so /garden/bed/list is "terros garden bed list".
To see help text, you can run:

  terros help
  terros <command> help
  terros <command> <subcommand> ... help
`.trim()

export const REPORT_KPI_HELP = `
Build a tabular KPI report. --version 2 is required: it selects the current table response, whose rows and totalRow
cells appear in the same order as --kpis. The CLI schema supports only version 2, not the legacy report shape.

Pass --grouping as a JSON object. Supported forms are {"type":"user"}, {"type":"company"},
{"type":"team","level":<number>}, {"type":"time","period":"hour|day|week|month|quarter|year"},
{"type":"manager","level":<number>}, {"type":"state"}, {"type":"city"}, {"type":"zip"},
{"type":"customField","customFieldId":"CF.example"}, and {"type":"programTask"}. manager.level is optional.
Calendar periods use the querying user's timezone.

Pass --kpis as a JSON array of {"value":"...","accumulator":"..."} objects. First call
"terros report column" and copy its value and accumulator unchanged; availability depends on permissions,
reporting configuration, and the selected workflows/programs. Important value forms include:
  {"value":"groupBy"}                         grouped entity or value (include this for row labels)
  {"value":"setter|S.example|count"}         accounts reaching a stage, attributed to their setter
  {"value":"closer|S.example|count"}         accounts reaching a stage, attributed to their closer
  {"value":"action|A.example|count"}         occurrences of a workflow action
  {"value":"cf|setter|count|CF.example|S.example"} custom-field count; role may be setter, closer, or account,
                                                   aggregation may be count or sum, and the final field may be
                                                   a stage/status ID or createdDate
  {"value":"Ratio.example"}                  saved ratio/formula (preferred; use the value returned by column)
  {"value":"ratio|<numerator>|<denominator>"} legacy inline ratio
  {"value":"user.firstAccessDate"}            user field; also lastAccessDate, count, and teams
Action summary values such as action.daysWorked, action.hoursWorked, action.headcount, and action.accounts are
also supported when returned by "terros report column".

The groupBy cell is a user/team/company/task object when the group key identifies one, the bucket-start epoch
milliseconds for time grouping, or otherwise the group key. Without {"value":"groupBy"}, rows contain no group
label. Each other cell is the KPI value requested at that array position.

Setter and closer stage counts count accounts that reached the stage within the filter dates; they attribute the
count through the account's setter or closer. They do not mean "currently in this stage" unless
--searchByCurrentStatus true is also sent. Use the accumulator returned by "terros report column": use sum for
additive values such as action occurrences, and distinct/query for account counts that need a separate
company-grouped total rather than a sum of row counts.

filter.startDate and filter.endDate are inclusive activity boundaries, applied to the activity/last-action date,
in the querying user's timezone. Millisecond inputs are exact instants. Equal boundaries select only that instant,
not a whole day, so a start and end at the same midnight commonly return no rows; for one calendar day, pass its
start and its inclusive end (for example 00:00:00.000 through 23:59:59.999 in that timezone).

A ratio is calculated per row and is not additive. Its totalRow cell is null when no supported accumulator defines
how to total it. Copy the ratio's accumulator from "terros report column": avg combines row ratios, while
distinct/query runs a company-grouped query so the ratio is recalculated from total-scope inputs.

Example (synthetic IDs; one UTC day):
  terros report kpi --version 2 --grouping '{"type":"user"}' \\
    --kpis '[{"value":"groupBy"},{"value":"action|A.example|count","accumulator":"sum"},{"value":"setter|S.example|count","accumulator":"distinct"}]' \\
    --filter.startDate 1767225600000 --filter.endDate 1767311999999
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
  subcommands: string[] = []
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
    })
  }

  if (showDepthHelp) {
    lines.push(
      '',
      `Use "--depth <number>" to control nested object type detail.`,
      `Use "--inputFile <path>" to send a JSON request body from a file ("-" for stdin); flags override its fields.`
    )
  }

  if (subcommands.length > 0) {
    lines.push('', 'Subcommands:', ...subcommands.map((name) => `  ${name}`))
  }

  return lines.join('\n')
}
