import { expect } from 'vitest'
import {
  formatCommandsHelp,
  formatCommandUsage,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
} from './messages'

describe('formatCommandsHelp', () => {
  it('includes version help after the command list', () => {
    expect(formatCommandsHelp(['account'])).toBe(`usage: terros <command> [<subcommand> ...] [parameters]

Commands:
  account

Run "terros <command> help" to see subcommands.
Run "terros --version" to print the installed CLI version.`)
  })
})

describe('formatSubcommandsHelp', () => {
  it('prints the full command path at a nested level', () => {
    expect(formatSubcommandsHelp('garden bed', ['list', 'tag']))
      .toBe(`usage: terros garden bed <subcommand> [parameters]

Subcommands:
  list
  tag

Run "terros garden bed <subcommand> help" to see its parameters or nested subcommands.`)
  })
})

describe('formatCommandUsage', () => {
  it('points at help for a nested endpoint command', () => {
    expect(formatCommandUsage('garden bed list')).toBe(`usage: terros garden bed list [parameters]

Run "terros garden bed list help" to see its parameters.`)
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

  it('formats help for a command without a subcommand', () => {
    expect(formatSubcommandParametersHelp('search', undefined, [])).toBe(`usage: terros search [parameters]

Parameters:
  none`)
  })

  it('lists nested subcommands below an endpoint that also has them', () => {
    expect(formatSubcommandParametersHelp('garden', undefined, [], undefined, true, ['bed'])).toBe(
      `usage: terros garden [parameters]

Parameters:
  none

Use "--depth <number>" to control nested object type detail.

Subcommands:
  bed`
    )
  })
})
