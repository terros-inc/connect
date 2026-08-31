import { expect } from 'vitest'
import type { Schema } from './types'
import { getEndpointParameters, type Components } from './parameters'

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

  it('expands one layer of object properties and folds enum values into the type', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        grouping: {
          oneOf: [
            {
              type: 'object',
              properties: {
                level: { type: 'integer' },
              },
              required: ['level'],
            },
            {
              type: 'object',
              properties: {},
            },
          ],
        },
        accumulator: {
          type: 'string',
          enum: ['total', 'average'],
        },
      },
    }

    const components = { schemas: {} }

    expect(getEndpointParameters(schema, components)).toEqual([
      {
        name: 'grouping',
        type: '{ level: integer } | {}',
        required: false,
      },
      {
        name: 'accumulator',
        type: '"total" | "average"',
        required: false,
      },
    ])
  })

  it('limits recursive array item types to the requested depth', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        items: {
          $ref: '#/components/schemas/RecursiveItems',
        },
      },
    }

    const components: Components = {
      schemas: {
        RecursiveItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              children: {
                $ref: '#/components/schemas/RecursiveItems',
              },
            },
          },
        },
      },
    }

    expect(getEndpointParameters(schema, components)).toEqual([
      {
        name: 'items',
        type: '{ children?: object[] }[]',
        required: false,
      },
    ])

    expect(getEndpointParameters(schema, components, 2)).toEqual([
      {
        name: 'items',
        type: '{ children?: { children?: object[] }[] }[]',
        required: false,
      },
    ])
  })
})
