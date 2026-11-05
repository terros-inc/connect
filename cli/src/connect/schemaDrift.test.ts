import { readFile } from 'node:fs/promises'
import { CONNECT_SCRIPT_SCHEMA_URL } from './validate'

const run = process.env.RUN_CONNECT_SCHEMA_DRIFT === '1' ? it : it.skip

it('detects drift in schema-valued additionalProperties', () => {
  const local = scriptSchema({ additionalProperties: { type: 'string' } })
  const server = scriptSchema({ additionalProperties: { type: 'object' } })

  expect(sharedScriptShapes(local, server)).toEqual(['outgoing.authSchema'])
})

run('keeps configSchema.json aligned with the server fields the CLI sends', async () => {
  const response = await fetch(CONNECT_SCRIPT_SCHEMA_URL)
  expect(response.ok).toBe(true)
  const server = (await response.json()) as Schema
  const local = JSON.parse(await readFile(new URL('../../configSchema.json', import.meta.url), 'utf8')) as Schema

  expect(sharedScriptShapes(local, server)).toEqual([])
})

type Schema = {
  oneOf?: Schema[]
  properties?: Record<string, Schema>
  items?: Schema
  required?: string[]
  enum?: unknown[]
  [key: string]: unknown
}

function sharedScriptShapes(local: Schema, server: Schema): string[] {
  const localVariants = local.properties?.scripts?.items?.oneOf ?? []
  const serverVariants = server.oneOf ?? []
  const differences: string[] = []
  for (const localVariant of localVariants) {
    const type = localVariant.properties?.type?.enum?.[0]
    const serverVariant = serverVariants.find((variant) => variant.properties?.type?.enum?.[0] === type)
    if (!serverVariant) {
      differences.push(`${String(type)}: missing from server schema`)
      continue
    }
    for (const field of Object.keys(localVariant.properties ?? {}).filter((name) => name !== 'entrypoint')) {
      const localField = localVariant.properties?.[field]
      const serverField = serverVariant.properties?.[field]
      if (!serverField) continue
      const localShape = {
        required: localVariant.required?.includes(field) ?? false,
        schema: normalize(localField),
      }
      const serverShape = {
        required: serverVariant.required?.includes(field) ?? false,
        schema: normalize(serverField),
      }
      if (JSON.stringify(localShape) !== JSON.stringify(serverShape)) differences.push(`${String(type)}.${field}`)
    }
  }
  return differences
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, child]) =>
          key !== 'description' &&
          (key !== 'additionalProperties' || (child !== null && typeof child === 'object' && !Array.isArray(child)))
      )
      .map(([key, child]) => [key, normalize(child)])
  )
}

function scriptSchema(authSchema: Schema): Schema {
  return {
    properties: {
      scripts: {
        items: {
          oneOf: [
            {
              properties: {
                type: { enum: ['outgoing'] },
                authSchema,
              },
              required: ['type', 'authSchema'],
            },
          ],
        },
      },
    },
    oneOf: [
      {
        properties: {
          type: { enum: ['outgoing'] },
          authSchema,
        },
        required: ['type', 'authSchema'],
      },
    ],
  }
}
