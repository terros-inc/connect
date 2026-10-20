import { expect } from 'vitest'
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
})
