import { expect } from 'vitest'
import type { Schema } from './types'
import { getEndpointParameters } from './parameters'

describe('getEndpointParameters', () => {
  it('formats an OpenAPI 3.1 tuple defined with prefixItems', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        sortTimestamp: {
          $ref: '#/components/schemas/SortTimestamp',
        },
      },
      required: ['sortTimestamp'],
    }

    const components = {
      schemas: {
        SortTimestamp: {
          type: 'array',
          prefixItems: [{ type: 'number' }, { type: 'string' }],
        } satisfies Schema,
      },
    }

    expect(getEndpointParameters(schema, components)).toEqual([
      {
        name: 'sortTimestamp',
        type: '[number, string]',
        required: true,
      },
    ])
  })
})
