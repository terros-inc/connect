import { getInputSchema } from './schema.ts'
import type { Endpoint } from './endpoint.ts'

it('collects transitive and recursive refs while excluding unused schemas', () => {
  const endpoint: Endpoint = {
    path: '/thing/get',
    properties: { type: 'object', properties: { root: { $ref: '#/components/schemas/Root' } } },
    components: {
      schemas: {
        Root: { type: 'object', properties: { child: { $ref: '#/components/schemas/Child' } } },
        Child: { type: 'object', properties: { parent: { $ref: '#/components/schemas/Root' } } },
        Unused: { type: 'string' },
      },
    },
  }
  expect(getInputSchema(endpoint)).toMatchObject({
    components: { schemas: { Root: endpoint.components.schemas.Root, Child: endpoint.components.schemas.Child } },
  })
  expect((getInputSchema(endpoint).components as any).schemas).not.toHaveProperty('Unused')
})

it('rejects missing references', () => {
  const endpoint: Endpoint = {
    path: '/thing/get',
    properties: { $ref: '#/components/schemas/Missing' },
    components: { schemas: {} },
  }
  expect(() => getInputSchema(endpoint)).toThrow('Unknown schema reference')
})
