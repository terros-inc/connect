import { expect } from 'vitest'
import { formatSubcommandParametersHelp } from './messages'

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
})
