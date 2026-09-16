import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { buildTerrosClient } from '../api/query'
import { getPathParts } from './util'
import type { OpenAPISchema } from './types'
import type { EndpointGroups } from './endpoint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const INTERNAL_OPENAPI_ROUTE = 'openapi/internal'
const CACHE_DIR_MODE = 0o700
const CACHE_FILE_MODE = 0o600

export function loadEndpoints(): EndpointGroups {
  const file = readFileSync(resolve(__dirname, '../terros.yml'), 'utf-8')
  const publicSchema: OpenAPISchema = parse(file)
  const internalSchema = readInternalSchema()

  return buildEndpoints(internalSchema === null ? [publicSchema] : [publicSchema, internalSchema])
}

export function buildEndpoints(schemas: Pick<OpenAPISchema, 'paths' | 'components'>[]): EndpointGroups {
  const endpoints: EndpointGroups = {}

  schemas.forEach((openApiSchema) => {
    const entries = Object.entries(openApiSchema.paths)

    entries.forEach(([path, config]) => {
      const { group, alias } = getPathParts(path)
      const existingEndpoints = endpoints[group]
      const existingDirectEndpoint = existingEndpoints?.[group]
      if ((path === `/${alias}` && existingEndpoints) || existingDirectEndpoint?.path === `/${group}`) {
        throw new Error(`Cannot combine direct and grouped endpoints for command: ${group}`)
      }

      endpoints[group] ??= {}

      const schema = config.post.requestBody.content['application/json'].schema

      endpoints[group][alias] = {
        path,
        description: config.post.description ?? config.post.summary,
        properties: schema,
        components: openApiSchema.components,
      }
    })
  })

  return endpoints
}

export async function cacheInternalEndpoints(): Promise<void> {
  try {
    const updatedSchema = await buildTerrosClient().call<unknown>(INTERNAL_OPENAPI_ROUTE, {})

    if (!isOpenApiSchema(updatedSchema)) {
      await removeInternalSchema()
      return
    }

    try {
      await saveInternalSchema(updatedSchema)
    } catch {}
  } catch {
    await removeInternalSchema()
    return
  }
}

function readInternalSchema(): OpenAPISchema | null {
  try {
    const file = readFileSync(getCacheFilePath(), 'utf-8')
    const schema: unknown = JSON.parse(file)
    return isOpenApiSchema(schema) ? schema : null
  } catch {
    return null
  }
}

async function saveInternalSchema(schema: OpenAPISchema): Promise<void> {
  const cacheDirectory = getCacheDirectory()
  await mkdir(cacheDirectory, { recursive: true, mode: CACHE_DIR_MODE })
  await chmod(cacheDirectory, CACHE_DIR_MODE)
  const cacheFile = getCacheFilePath()
  await writeFile(cacheFile, JSON.stringify(schema), { mode: CACHE_FILE_MODE })
  await chmod(cacheFile, CACHE_FILE_MODE)
}

async function removeInternalSchema(): Promise<void> {
  try {
    await unlink(getCacheFilePath())
  } catch {}
}

function getCacheDirectory(): string {
  return join(homedir(), '.config', 'terros')
}

function getCacheFilePath(): string {
  return join(getCacheDirectory(), 'internal-openapi.json')
}

function isOpenApiSchema(schema: unknown): schema is OpenAPISchema {
  if (typeof schema !== 'object' || schema === null) return false
  if (!('paths' in schema)) return false
  if (typeof schema.paths !== 'object') return false
  if (schema.paths === null) return false
  if (!('components' in schema)) return false
  if (typeof schema.components !== 'object') return false
  if (schema.components === null) return false
  return true
}
