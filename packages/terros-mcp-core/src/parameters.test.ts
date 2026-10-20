import { expect } from 'vitest'
import type { Schema } from './types.ts'
import { getEndpointParameters, type Components } from './parameters.ts'

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

  it('keeps a description written beside a $ref over the referenced schema description', () => {
    // zod-openapi emits `.describe()` on a shared schema as a component holding `description` beside a `$ref`.
    const schema: Schema = {
      type: 'object',
      properties: {
        entityId: { $ref: '#/components/schemas/DescribedEntityId' },
        expiresAt: { $ref: '#/components/schemas/DescribedSeconds' },
      },
      required: ['entityId'],
    }
    const components: Components = {
      schemas: {
        DescribedEntityId: { description: 'Entity whose entitlements change', $ref: '#/components/schemas/EntityId' },
        EntityId: {
          oneOf: [
            { $ref: '#/components/schemas/UserId' },
            { $ref: '#/components/schemas/TeamId' },
            { $ref: '#/components/schemas/CompanyId' },
          ],
        },
        UserId: { type: 'string', description: 'User ID' },
        TeamId: { type: 'string', description: 'Team ID' },
        CompanyId: { type: 'string', description: 'Company ID' },
        DescribedSeconds: { description: 'When it expires', $ref: '#/components/schemas/Seconds' },
        Seconds: { description: 'A timestamp in UTC seconds', $ref: '#/components/schemas/Number' },
        Number: { type: 'number' },
      },
    }

    expect(getEndpointParameters(schema, components)).toEqual([
      { name: 'entityId', type: 'string', required: true, description: 'Entity whose entitlements change' },
      { name: 'expiresAt', type: 'number', required: false, description: 'When it expires' },
    ])
  })

  it('prints a union of identical types once, without array parentheses', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'string' }] } },
        values: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'string' }] } },
      },
    }

    expect(getEndpointParameters(schema, { schemas: {} })).toEqual([
      { name: 'ids', type: 'string[]', required: false },
      { name: 'values', type: '(string | number)[]', required: false },
    ])
  })
})
