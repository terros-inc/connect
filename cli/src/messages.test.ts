import { expect } from 'vitest'
import { getEndpointParameters, parseEndpoints } from '@terros-inc/mcp-core'
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

describe('endpoint help for entitlement add and remove', () => {
  // Same shape as the generated internal document: each described field is a component of `description` beside `$ref`.
  const input = (fields: Record<string, string>, required: string[]): object => ({
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(fields).map(([name, schema]) => [name, { $ref: `#/components/schemas/${schema}` }])
    ),
    required,
  })
  const path = (description: string, schema: object): object => ({
    post: { description, requestBody: { content: { 'application/json': { schema } } } },
  })
  const groups = parseEndpoints(
    JSON.stringify({
      openapi: '3.1.1',
      paths: {
        '/entitlement/add': path(
          'Grants entitlements.',
          input({ entityId: 'TargetId', entitlements: 'AddNames', expiresAt: 'ExpiresAt' }, [
            'entityId',
            'entitlements',
          ])
        ),
        '/entitlement/remove': path(
          'Removes entitlements.',
          input({ entityId: 'TargetId', entitlements: 'RemoveNames' }, ['entityId', 'entitlements'])
        ),
      },
      components: {
        schemas: {
          TargetId: {
            description: 'The user, team, or company ID whose entitlements change.',
            $ref: '#/components/schemas/EntityId',
          },
          EntityId: {
            anyOf: [
              { $ref: '#/components/schemas/userId' },
              { $ref: '#/components/schemas/teamId' },
              { $ref: '#/components/schemas/companyId' },
            ],
          },
          userId: { description: 'Unique identifier for the user', $ref: '#/components/schemas/Id' },
          teamId: { description: 'Unique identifier for the team', $ref: '#/components/schemas/Id' },
          companyId: { description: 'Unique identifier for the company', $ref: '#/components/schemas/Id' },
          Id: { type: 'string' },
          AddNames: {
            type: 'array',
            items: { type: 'string', enum: ['recording', 'recruiting'] },
            description: 'Entitlement names to grant.',
          },
          RemoveNames: {
            type: 'array',
            items: { type: 'string', enum: ['recording', 'recruiting'] },
            description: 'Entitlement names to remove.',
          },
          ExpiresAt: {
            description: 'When the entitlements expire, in UTC seconds.',
            $ref: '#/components/schemas/utcSeconds',
          },
          utcSeconds: { description: 'A timestamp in UTC seconds', $ref: '#/components/schemas/Seconds' },
          Seconds: { type: 'number' },
        },
      },
    })
  )
  const help = (command: 'add' | 'remove'): string => {
    const endpoint = groups.entitlement?.[command]
    if (!endpoint) throw new Error(`missing entitlement ${command}`)
    return formatSubcommandParametersHelp(
      `entitlement ${command}`,
      undefined,
      getEndpointParameters(endpoint.properties, endpoint.components),
      endpoint.description,
      true
    )
  }

  it('describes --entityId and --expiresAt and prints the ID union as string', () => {
    expect(help('add')).toBe(`usage: terros entitlement add [parameters]

Grants entitlements.

Parameters:
  --entityId
    type         string
    required     yes
    description  The user, team, or company ID whose entitlements change.

  --entitlements
    type         ("recording" | "recruiting")[]
    required     yes
    description  Entitlement names to grant.

  --expiresAt
    type         number
    required     no
    description  When the entitlements expire, in UTC seconds.

Use "--depth <number>" to control nested object type detail.`)
  })

  it('describes --entityId for remove too', () => {
    expect(help('remove')).toContain(`  --entityId
    type         string
    required     yes
    description  The user, team, or company ID whose entitlements change.`)
  })
})
