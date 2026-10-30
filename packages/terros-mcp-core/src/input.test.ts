import { expect } from 'vitest'
import { getEndpointParameters } from './parameters.ts'
import { buildEndpointInput, getEndpointInputParameters, UnknownParameterError, type ParsedArgs } from './input.ts'
import type { Endpoint } from './endpoint.ts'

describe('buildEndpointInput', () => {
  it('identifies unknown flags by error type so schema refresh does not depend on wording', () => {
    const endpoint: Endpoint = {
      path: '/garden/list',
      components: { schemas: {} },
      properties: { type: 'object', properties: {} },
    }
    expect(() => buildEndpointInput(endpoint, { _: [], unsupported: true })).toThrow(UnknownParameterError)
  })

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

  describe('request body that is a union or wraps one', () => {
    // Shaped like `/user/remove`: the body was one unnamed `--` parameter that no flag or JSON could fill.
    const userRemove: Endpoint = {
      path: '/user/remove',
      components: {
        schemas: {
          Input: { anyOf: [{ $ref: '#/components/schemas/Single' }, { $ref: '#/components/schemas/Bulk' }] },
          Single: {
            type: 'object',
            properties: { archive: { type: 'boolean' }, userId: { type: 'string' } },
            required: ['userId'],
          },
          Bulk: {
            type: 'object',
            properties: { archive: { type: 'boolean' }, userIds: { type: 'array', items: { type: 'string' } } },
            required: ['userIds'],
          },
        },
      },
      properties: { $ref: '#/components/schemas/Input' },
    }

    it('offers every variant field, required only when every variant requires it', () => {
      expect(getEndpointInputParameters(userRemove)).toEqual([
        { name: 'archive', type: 'boolean', required: false },
        { name: 'userId', type: 'string', required: false },
        { name: 'userIds', type: 'string[]', required: false },
      ])
    })

    it('sends a single or bulk user remove body', () => {
      expect(buildEndpointInput(userRemove, { _: [], userId: '<userId>', archive: 'false' })).toEqual({
        userId: '<userId>',
        archive: false,
      })
      expect(buildEndpointInput(userRemove, { _: [], userIds: '["<userId1>","<userId2>"]' })).toEqual({
        userIds: ['<userId1>', '<userId2>'],
      })
    })

    // Shaped like `/customField/update`: the wrapped object is an `allOf` of a typed union and plain objects, which
    // was one `--customField` parameter of type `unknown`.
    it('expands an allOf wrapped in a single object and sends the fields inside the wrapper', () => {
      const customFieldUpdate: Endpoint = {
        path: '/customField/update',
        components: { schemas: {} },
        properties: {
          type: 'object',
          properties: {
            customField: {
              allOf: [
                {
                  type: 'object',
                  oneOf: [
                    {
                      type: 'object',
                      properties: { label: { type: 'string' }, fieldType: { type: 'string', enum: ['number'] } },
                      required: ['label', 'fieldType'],
                    },
                    {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        fieldType: { type: 'string', enum: ['multipleChoice'] },
                        options: { type: 'array', items: { type: 'string' } },
                      },
                      required: ['label', 'fieldType'],
                    },
                  ],
                },
                { type: 'object', properties: { fieldId: { type: 'string' } }, required: ['fieldId'] },
              ],
            },
          },
          required: ['customField'],
        },
      }

      expect(getEndpointInputParameters(customFieldUpdate)).toEqual([
        { name: 'label', type: 'string', required: true },
        { name: 'fieldType', type: '"number" | "multipleChoice"', required: true },
        { name: 'options', type: 'string[]', required: false },
        { name: 'fieldId', type: 'string', required: true },
      ])
      expect(
        buildEndpointInput(customFieldUpdate, {
          _: [],
          fieldId: 'CF.example',
          label: 'Roof type',
          fieldType: 'multipleChoice',
          options: 'Shingle,Metal',
        })
      ).toEqual({
        customField: {
          fieldId: 'CF.example',
          label: 'Roof type',
          fieldType: 'multipleChoice',
          options: ['Shingle', 'Metal'],
        },
      })
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

  // Shaped like `/question/manage/list --archived` and `/company/list --kinds`, which agents passed as bare values.
  describe('archived filter and enum list parameters', () => {
    const endpoint: Endpoint = {
      path: '/company/list',
      components: { schemas: { companyKind: { type: 'string', enum: ['customer', 'demo', 'sandbox'] } } },
      properties: {
        type: 'object',
        properties: {
          archived: { anyOf: [{ type: 'boolean' }, { type: 'string', const: 'all' }] },
          kinds: { type: 'array', items: { $ref: '#/components/schemas/companyKind' } },
        },
      },
    }
    const build = (params: Record<string, unknown>): unknown => buildEndpointInput(endpoint, { _: [], ...params })

    it('accepts a bare literal or boolean in a boolean | literal union', () => {
      expect(build({ archived: 'all' })).toEqual({ archived: 'all' })
      expect(build({ archived: '"all"' })).toEqual({ archived: 'all' })
      expect(build({ archived: 'false' })).toEqual({ archived: false })
    })

    it('accepts an enum list as a bare value, comma-separated values or a JSON array', () => {
      expect(build({ kinds: 'customer' })).toEqual({ kinds: ['customer'] })
      expect(build({ kinds: 'customer,demo' })).toEqual({ kinds: ['customer', 'demo'] })
      expect(build({ kinds: '["customer","demo"]' })).toEqual({ kinds: ['customer', 'demo'] })
    })
  })

  describe('string parameters', () => {
    const endpoint: Endpoint = {
      path: '/search',
      components: { schemas: {} },
      properties: {
        type: 'object',
        properties: { query: { type: 'string' }, companyIds: { type: 'array', items: { type: 'string' } } },
      },
    }
    const build = (params: Record<string, unknown>): unknown => buildEndpointInput(endpoint, { _: [], ...params })

    // A JSON-quoted id was sent with its quotes, so the API rejected it with `companyIds.0: Invalid input`.
    it('accepts an id bare or JSON-quoted', () => {
      expect(build({ companyIds: 'C.example' })).toEqual({ companyIds: ['C.example'] })
      expect(build({ companyIds: '"C.example"' })).toEqual({ companyIds: ['C.example'] })
      expect(build({ companyIds: '"C.example","C.other"' })).toEqual({ companyIds: ['C.example', 'C.other'] })
      expect(build({ companyIds: '["C.example"]' })).toEqual({ companyIds: ['C.example'] })
      expect(build({ query: '"Acme Solar"' })).toEqual({ query: 'Acme Solar' })
    })

    // A shell or script that pads the quoted value used to send the quotes, as with no decoding at all.
    it('decodes a JSON-quoted value with surrounding whitespace', () => {
      expect(build({ query: ' "C.example" ' })).toEqual({ query: 'C.example' })
      expect(build({ query: '\t"C.example"\n' })).toEqual({ query: 'C.example' })
      expect(build({ query: ' C.example' })).toEqual({ query: ' C.example' })
    })

    // Text that only starts with a quote is not a JSON string and must be sent as typed, not rejected.
    it('sends a value that is not a JSON string unchanged', () => {
      expect(build({ query: '"Acme' })).toEqual({ query: '"Acme' })
      expect(build({ query: 'say "hi"' })).toEqual({ query: 'say "hi"' })
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
          // The API wraps the members as `anyOf: [{ anyOf: members }, { type: 'null' }]`.
          Value: { anyOf: [{ $ref: '#/components/schemas/Members' }, { type: 'null' }] },
          Members: {
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
      expect(type?.endsWith('[] | null')).toBe(true)
    })

    it('sends a string literal as a string', () => {
      // A normal preference update must not become a nested list or an accidental clear.
      expect(value('Warn')).toBe('Warn')
    })

    // An intentional reset must send JSON null rather than a string or a list containing "null".
    it('sends a nullable value as null', () => {
      expect(value('null')).toBeNull()
      expect(value(null)).toBeNull()
    })

    // Forgetting --value must not clear a setting just because the API allows omission.
    it('requires an explicit value for preference updates', () => {
      expect(getEndpointInputParameters(endpoint).find((parameter) => parameter.name === 'value')?.required).toBe(true)
      expect(() => buildEndpointInput(endpoint, { _: [], preference: 'example' })).toThrow(
        'Missing required parameter(s): --value'
      )
    })

    // A reset explicitly supplied by --inputFile must not be rejected as a missing value.
    it('accepts null from the base request body without a value flag', () => {
      expect(buildEndpointInput(endpoint, { _: [], preference: 'example' }, { value: null })).toEqual({
        preference: 'example',
        value: null,
      })
    })

    // Nullable parsing must not turn the text "null" in an ordinary string parameter into a clear.
    it('preserves null text in a non-nullable string parameter', () => {
      expect(buildEndpointInput(endpoint, { _: [], preference: 'null', value: 'Warn' })).toEqual({
        preference: 'null',
        value: 'Warn',
      })
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

    // A list item union that deduplicates to one enum rendered as `"a" | "b"[]`, so `a,b` matched no member.
    it('keeps a list whose item union deduplicates to one enum whole', () => {
      const endpoint: Endpoint = {
        path: '/example',
        components: { schemas: { Direction: { type: 'string', enum: ['north', 'south'] } } },
        properties: {
          type: 'object',
          properties: {
            field: {
              type: 'array',
              items: {
                anyOf: [{ $ref: '#/components/schemas/Direction' }, { $ref: '#/components/schemas/Direction' }],
              },
            } as Endpoint['properties'],
          },
        },
      }
      expect(getEndpointParameters(endpoint.properties, endpoint.components)[0]?.type).toBe('("north" | "south")[]')
      expect(buildEndpointInput(endpoint, { _: [], field: 'north,south' })).toEqual({ field: ['north', 'south'] })
      expect(buildEndpointInput(endpoint, { _: [], field: '["south"]' })).toEqual({ field: ['south'] })
    })

    it('keeps a literal that contains `|` whole', () => {
      const schema = { anyOf: [{ type: 'number' }, { type: 'string', enum: ['a|b', 'c'] }] } as Endpoint['properties']
      expect(field(schema, 'a|b')).toBe('a|b')
    })

    it('keeps the order of scalar members, so a string listed first still wins', () => {
      const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] } as Endpoint['properties']
      expect(field(schema, '60')).toBe('60')
      // A leading string member must not swallow an explicit nullable reset as the text "null".
      const nullable = { anyOf: [{ type: 'string' }, { type: 'null' }] } as Endpoint['properties']
      expect(field(nullable, 'null')).toBeNull()
      expect(field(nullable, null)).toBeNull()
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
