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

Reading the response: rows and totalRow are positional arrays aligned index-by-index with --kpis, so
rows[rowIndex][kpiIndex] is that row's value for --kpis[kpiIndex] and totalRow[kpiIndex] is the report-wide total
for --kpis[kpiIndex]. Include {"value":"groupBy"} in --kpis (typically at index 0) so that rows[rowIndex][0]
identifies the group (a user/team/company/task object when the group key identifies one, the bucket-start epoch
milliseconds for time grouping, or otherwise the scalar group key) and totalRow[0] holds "Total" or null. Without
{"value":"groupBy"}, rows contain only metric values and no group identifier. Each other cell is the KPI value
requested at that array position. The /report/kpi response does not repeat column metadata (label, description,
type, formatters); to label or format each column in rows and totalRow, match --kpis[kpiIndex].value to the
columns or leaderboardColumns returned by "terros report column".

Setter and closer stage counts count accounts whose stage-entry date is within the filter dates; they do not use
the account's last-action date. They attribute the count through the account's setter or closer, and do not mean
"currently in this stage" unless --searchByCurrentStatus true is also sent. Use the accumulator returned by
"terros report column": use sum for additive values such as action occurrences, and distinct/query for account
counts that need a separate company-grouped total rather than a sum of row counts.

filter.startDate and filter.endDate are inclusive when enforced. Most activity KPIs apply them to the activity or
account last-action date; setter/closer stage counts apply them to the stage-entry date. On the account-history
stage-count path, no date range is applied without filter.startDate, so filter.endDate alone is not enforced;
always supply both boundaries for setter/closer counts. Millisecond inputs are exact instants. Date strings with Z
or an explicit offset use that timezone; strings without a timezone use the API's default timezone, not the
querying user's timezone. Equal boundaries select only that instant, not a whole day, so a start and end at the
same midnight commonly return no rows; for one calendar day, pass its start and its inclusive end (for example
00:00:00.000 through 23:59:59.999 with the same timezone).

A ratio is calculated per row and is not additive. Its totalRow cell is null when no supported accumulator defines
how to total it. Copy the ratio's accumulator from "terros report column": avg combines row ratios, while
distinct/query runs a company-grouped query so the ratio is recalculated from total-scope inputs.

Example (synthetic IDs; one UTC day):
  terros report kpi --version 2 --grouping '{"type":"user"}' \\
    --kpis '[{"value":"groupBy"},{"value":"action|A.example|count","accumulator":"sum"},{"value":"setter|S.example|count","accumulator":"distinct"}]' \\
    --filter.startDate 1767225600000 --filter.endDate 1767311999999
  # Result mapping for the 3 --kpis entries:
  #   rows[i][0] = user object for groupBy               totalRow[0] = "Total"
  #   rows[i][1] = count for action|A.example|count      totalRow[1] = sum across rows
  #   rows[i][2] = count for setter|S.example|count      totalRow[2] = distinct total
`.trim()

const REPORT_KPI_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  'filter.startDate':
    "Inclusive start. Most activity KPIs use the activity or account last-action date; setter/closer counts use the stage-entry date. Supply both date boundaries for setter/closer counts. Numeric milliseconds are exact instants; date strings without a timezone use the API's default timezone.",
  'filter.endDate':
    "Inclusive end when enforced. An end date alone is not enforced on the account-history setter/closer count path; supply both date boundaries. Numeric milliseconds are exact instants; date strings without a timezone use the API's default timezone.",
}

export function getReportKpiHelpParameters(parameters: EndpointParameter[]): EndpointParameter[] {
  return parameters.map((parameter) => ({
    ...parameter,
    description: REPORT_KPI_PARAMETER_DESCRIPTIONS[parameter.name] ?? parameter.description,
  }))
}

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
