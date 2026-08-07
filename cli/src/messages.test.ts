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
  --grouping  "team" | "user"  required`)
  })

  it('truncates long types', () => {
    const longType = Array.from({ length: 10 }, (_, i) => `"value${i}"`).join(' | ')

    const result = formatSubcommandParametersHelp('report', 'kpi', [
      {
        name: 'accumulator',
        type: longType,
        required: false,
      },
    ])

    const typeColumn = result.split('\n').at(-1)?.split('  ')[2]
    expect(typeColumn?.length).toBeLessThan(longType.length)
    expect(typeColumn?.endsWith('…')).toBe(true)
  })
})
