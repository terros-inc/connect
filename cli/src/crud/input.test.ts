import { expect } from 'vitest'
import type { ParsedArgs } from 'minimist'
import { buildEndpointInput } from './input'
import type { Endpoint } from './endpoint'

describe('buildEndpointInput', () => {
  it('should not add a hidden wrapper prefix for a single non-object property', () => {
    const endpoint: Endpoint = {
      path: '/user/profile',
      parameters: [
        {
          name: 'userId',
          type: 'string',
          required: false,
        },
      ],
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

  it('should add a hidden wrapper prefix for a single object property', () => {
    const endpoint: Endpoint = {
      path: '/user/profile',
      parameters: [
        {
          name: 'userId',
          type: 'string',
          required: false,
        },
      ],
      properties: {
        type: 'object',
        properties: {
          profile: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
              },
            },
          },
        },
      },
    }

    const params: ParsedArgs = {
      _: ['user', 'profile'],
      userId: 'U:dj',
    }

    const expected = {
      profile: {
        userId: 'U:dj',
      },
    }

    const result = buildEndpointInput(endpoint, params)
    expect(result).toEqual(expected)
  })
})
