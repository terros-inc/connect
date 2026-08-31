import { expect } from 'vitest'
import { formatCommandsHelp, formatSubcommandParametersHelp } from './messages'

describe('formatCommandsHelp', () => {
  it('includes version help after the command list', () => {
    expect(formatCommandsHelp(['account'])).toBe(`usage: terros <command> <subcommand> [parameters]

Commands:
  account

Run "terros <command> help" to see subcommands.
Run "terros --version" to print the installed CLI version.`)
  })
})

describe('formatSubcommandParametersHelp', () => {
  it('prints parameter type, required, and description', () => {
    expect(
      formatSubcommandParametersHelp('report', 'kpi', [
        {
          name: 'grouping',
          type: '"team" | "user"',
          required: true,
        },
      ])
    ).toBe(`usage: terros report kpi [parameters]

Parameters:
  --grouping
    type         "team" | "user"
    required     yes`)
  })

  it('separates multiple parameters with a blank line', () => {
    expect(
      formatSubcommandParametersHelp('report', 'kpi', [
        { name: 'grouping', type: '"team" | "user"', required: true },
        { name: 'accumulator', type: 'string', required: false, description: 'how to combine values' },
      ])
    ).toBe(`usage: terros report kpi [parameters]

Parameters:
  --grouping
    type         "team" | "user"
    required     yes

  --accumulator
    type         string
    required     no
    description  how to combine values`)
  })

  it('includes depth help for API endpoints', () => {
    expect(formatSubcommandParametersHelp('report', 'kpi', [], undefined, true)).toBe(
      `usage: terros report kpi [parameters]

Parameters:
  none

Use "--depth <number>" to control nested object type detail.`
    )
  })
})
