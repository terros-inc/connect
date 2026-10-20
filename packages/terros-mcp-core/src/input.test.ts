import { expect } from 'vitest'
import { getEndpointParameters } from './parameters.ts'
import { buildEndpointInput, type ParsedArgs } from './input.ts'
import type { Endpoint } from './endpoint.ts'

describe('buildEndpointInput', () => {
  it('should not add a hidden wrapper prefix for a single non-object property', () => {
    const endpoint: Endpoint = {
      path: '/user/profile',
      components: { schemas: {} },
      properties: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
          },
        },
      },
    }

    const params: ParsedArgs = {
      _: ['user', 'profile'],
      userId: 'U:dj',
    }

    const expected = {
      userId: 'U:dj',
    }

    const result = buildEndpointInput(endpoint, params)
    expect(result).toEqual(expected)
  })

  it('does not add a hidden wrapper prefix for a generic object property', () => {
    const endpoint: Endpoint = {
      path: '/metadata/update',
      components: { schemas: {} },
      properties: {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
          },
        },
      },
    }

    const params: ParsedArgs = {
      _: ['metadata', 'update'],
      metadata: '{"source":"example"}',
    }

    expect(buildEndpointInput(endpoint, params)).toEqual({
      metadata: { source: 'example' },
    })
  })

  it('wraps user update parameters when the input and wrapper use schema references', () => {
    const endpoint: Endpoint = {
      path: '/user/update',
      components: {
        schemas: {
          UserUpdateInput: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/UserUpdateData' },
            },
            required: ['user'],
          },
          UserUpdateData: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              firstName: { type: 'string' },
              primaryTeam: {
                type: 'object',
                properties: {
                  teamId: { type: 'string' },
                  staleAfter: { type: 'integer' },
                },
              },
            },
            required: ['userId'],
          },
        },
      },
      properties: { $ref: '#/components/schemas/UserUpdateInput' },
    }

    const params: ParsedArgs = {
      _: ['user', 'update'],
      userId: 'U:placeholder',
      firstName: 'Example',
      primaryTeam: {
        teamId: 'Team.placeholder',
        staleAfter: 60000,
      },
    }

    expect(buildEndpointInput(endpoint, params)).toEqual({
      user: {
        userId: 'U:placeholder',
        firstName: 'Example',
        primaryTeam: {
          teamId: 'Team.placeholder',
          staleAfter: 60000,
        },
      },
    })
  })

  it('wraps account update parameters when the wrapper uses a schema reference', () => {
    const endpoint: Endpoint = {
      path: '/account/update',
      components: {
        schemas: {
          AccountUpdateData: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['accountId'],
          },
        },
      },
      properties: {
        type: 'object',
        properties: {
          account: { $ref: '#/components/schemas/AccountUpdateData' },
        },
        required: ['account'],
      },
    }

    const params: ParsedArgs = {
      _: ['account', 'update'],
      accountId: 'Account.placeholder',
      title: 'Example account',
    }

    expect(buildEndpointInput(endpoint, params)).toEqual({
      account: {
        accountId: 'Account.placeholder',
        title: 'Example account',
      },
    })
  })

  describe('enum parameters', () => {
    const endpoint: Endpoint = {
      path: '/entitlement/add',
      components: { schemas: { Names: { type: 'string', enum: ['canvass', 'weather_data', 'permits'] } } },
      properties: {
        type: 'object',
        properties: {
          entitlements: { type: 'array', items: { $ref: '#/components/schemas/Names' } },
          mode: { type: 'string', enum: ['replace'] },
        },
      },
    }
    const entitlements = (value: unknown): unknown =>
      buildEndpointInput(endpoint, { _: ['entitlement', 'add'], entitlements: value })

    // Each value was rejected with "expects valid JSON" because enum members were parsed as JSON.
    it('accepts a plain enum value', () => {
      expect(entitlements('weather_data')).toEqual({ entitlements: ['weather_data'] })
    })

    it('accepts comma-separated enum values', () => {
      expect(entitlements('weather_data,permits')).toEqual({ entitlements: ['weather_data', 'permits'] })
    })

    it('accepts a JSON array of enum values', () => {
      expect(entitlements('["weather_data","permits"]')).toEqual({ entitlements: ['weather_data', 'permits'] })
    })

    it('still accepts an already-quoted value', () => {
      expect(entitlements('"weather_data"')).toEqual({ entitlements: ['weather_data'] })
    })

    it('keeps an enum value containing | or [] whole', () => {
      const pipes: Endpoint = {
        path: '/pipe/set',
        components: { schemas: {} },
        properties: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['a|b'] },
            modes: { type: 'array', items: { type: 'string', enum: ['a|b', 'c'] } },
            list: { type: 'string', enum: ['x[]'] },
          },
        },
      }
      expect(buildEndpointInput(pipes, { _: [], mode: 'a|b', modes: '["a|b","c"]', list: 'x[]' })).toEqual({
        mode: 'a|b',
        modes: ['a|b', 'c'],
        list: 'x[]',
      })
    })

    it('accepts a single-value enum', () => {
      expect(buildEndpointInput(endpoint, { _: [], mode: 'replace' })).toEqual({ mode: 'replace' })
    })

    // The first enum member used to win for any quoted value, sending an unknown name to the API.
    it('rejects an unknown value and lists the valid ones', () => {
      expect(() => entitlements('weather')).toThrow(
        'Parameter --entitlements must be one of: canvass, weather_data, permits; got weather'
      )
      expect(() => entitlements('"weather"')).toThrow('must be one of: canvass, weather_data, permits')
      expect(() => buildEndpointInput(endpoint, { _: [], mode: 'append' })).toThrow(
        'Parameter --mode must be replace, got append'
      )
    })
  })

  describe('union parameters', () => {
    // Shaped like `/preference/update --value`: scalars, string literals, objects whose fields are unions, and
    // list members, ending in a list. The union used to be parsed as one list because the type ends in `[]`,
    // so `--value Warn` was sent as `[["Warn"]]`.
    const endpoint: Endpoint = {
      path: '/preference/update',
      components: {
        schemas: {
          Strategy: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['random', 'balanced'] },
              windowDays: { type: 'number' },
            },
            required: ['type'],
          },
          Value: {
            anyOf: [
              { type: 'number' },
              { type: 'boolean' },
              { type: 'string', enum: ['Allow', 'Warn', 'Deny'] },
              { type: 'array', items: { type: 'string' } },
              { $ref: '#/components/schemas/Strategy' },
              { type: 'array', items: { type: 'string', enum: ['solar', 'parcel boundaries'] } },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { workflowId: { type: 'string' }, stageId: { type: 'string' } },
                  required: ['workflowId', 'stageId'],
                },
              },
            ],
          },
        },
      },
      properties: {
        type: 'object',
        properties: { preference: { type: 'string' }, value: { $ref: '#/components/schemas/Value' } },
        required: ['preference'],
      },
    }
    const value = (input: unknown): unknown =>
      (
        buildEndpointInput(endpoint, { _: ['preference', 'update'], preference: 'example', value: input }) as {
          value: unknown
        }
      ).value

    it('renders the union with list and object members that hold their own `|`', () => {
      const type = getEndpointParameters(endpoint.properties, endpoint.components).find(
        (parameter) => parameter.name === 'value'
      )?.type
      expect(type).toContain('{ type: "random" | "balanced", windowDays?: number }')
      expect(type).toContain('("solar" | "parcel boundaries")[]')
      expect(type?.endsWith('[]')).toBe(true)
    })

    it('sends a string literal as a string', () => {
      expect(value('Warn')).toBe('Warn')
    })

    it('sends a boolean as a boolean', () => {
      expect(value('true')).toBe(true)
      expect(value('false')).toBe(false)
    })

    it('sends a number as a number', () => {
      expect(value('60')).toBe(60)
      expect(value('0.5')).toBe(0.5)
    })

    it('sends a comma-separated list as a list', () => {
      expect(value('first,second')).toEqual(['first', 'second'])
    })

    it('sends a JSON array as a list', () => {
      expect(value('["first","second"]')).toEqual(['first', 'second'])
      expect(value('["solar","parcel boundaries"]')).toEqual(['solar', 'parcel boundaries'])
      expect(value('[{"workflowId":"w1","stageId":"s1"}]')).toEqual([{ workflowId: 'w1', stageId: 's1' }])
    })

    it('sends a repeated flag as a list', () => {
      expect(value(['first', 'second'])).toEqual(['first', 'second'])
    })

    it('sends a JSON object as an object', () => {
      expect(value('{"type":"balanced","windowDays":7}')).toEqual({ type: 'balanced', windowDays: 7 })
    })
  })

  describe('splitting union types', () => {
    const endpointWith = (schema: Endpoint['properties']): Endpoint => ({
      path: '/example',
      components: { schemas: {} },
      properties: { type: 'object', properties: { field: schema } },
    })
    const field = (schema: Endpoint['properties'], input: unknown): unknown =>
      (buildEndpointInput(endpointWith(schema), { _: [], field: input }) as { field: unknown }).field

    // Splitting on every `|` cut `("a" | "b")[]` and `{ kind: "a" | "b" }` into broken members.
    it('keeps a list of literals inside a union whole', () => {
      const schema = {
        anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'string', enum: ['north', 'south'] } }],
      } as Endpoint['properties']
      expect(field(schema, 'north,south')).toEqual(['north', 'south'])
      expect(field(schema, '3')).toBe(3)
      expect(() => field(schema, 'east')).toThrow('does not match any supported type')
    })

    it('keeps an object whose field is a union whole', () => {
      const schema = {
        anyOf: [
          { type: 'boolean' },
          { type: 'object', properties: { kind: { type: 'string', enum: ['north', 'south'] } } },
        ],
      } as Endpoint['properties']
      expect(field(schema, '{"kind":"south"}')).toEqual({ kind: 'south' })
      expect(field(schema, 'yes')).toBe(true)
    })

    it('keeps a literal that contains `|` whole', () => {
      const schema = { anyOf: [{ type: 'number' }, { type: 'string', enum: ['a|b', 'c'] }] } as Endpoint['properties']
      expect(field(schema, 'a|b')).toBe('a|b')
    })

    it('keeps the order of scalar members, so a string listed first still wins', () => {
      const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] } as Endpoint['properties']
      expect(field(schema, '60')).toBe('60')
      const list = {
        anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      } as Endpoint['properties']
      expect(field(list, 'first,second')).toBe('first,second')
      expect(field(list, '["first","second"]')).toEqual(['first', 'second'])
    })
  })

  describe('with a base request body', () => {
    const endpoint: Endpoint = {
      path: '/workflow/update',
      components: { schemas: {} },
      properties: {
        type: 'object',
        properties: {
          workflow: {
            type: 'object',
            properties: { workflowId: { type: 'string' }, name: { type: 'string' } },
            required: ['workflowId'],
          },
          dryRun: { type: 'boolean' },
        },
        required: ['workflow'],
      },
    }

    it('accepts required parameters from the base and overrides its fields with flags', () => {
      const base = { workflow: { workflowId: 'WF.example', name: 'Old', stages: [] } }
      const params: ParsedArgs = { _: ['workflow', 'update'], workflow: { name: 'New' }, dryRun: 'true' }

      expect(buildEndpointInput(endpoint, params, base)).toEqual({
        workflow: { workflowId: 'WF.example', name: 'New', stages: [] },
        dryRun: true,
      })
      expect(base.workflow.name).toBe('Old')
    })

    it('still requires parameters that neither the base nor the flags hold', () => {
      expect(() => buildEndpointInput(endpoint, { _: [] }, { workflow: { name: 'New' } })).toThrow(
        '--workflow.workflowId'
      )
    })
  })
})
