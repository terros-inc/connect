import process from 'node:process'
import { basename, join, relative, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import { type z } from 'zod'
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import { CONFIG_FILE_NAME } from './constants'
import { ConnectConfig, type ConnectConfig as ConnectConfigData, type UnsavedScript } from './configSchema'

export const CONNECT_SCRIPT_SCHEMA_URL = 'https://docs.terros.com/openapi/connect-script.schema.json'

type JsonSchema = Record<string, unknown>
type RawManifest = { appId?: unknown; scripts?: unknown }

type WithoutEntrypoint<T> = T extends unknown ? Omit<T, 'entrypoint'> : never

export type ScriptPayload = WithoutEntrypoint<UnsavedScript> & {
  appId: `App.${string}`
  appVersion: string
  scriptStorage: 'blob'
}

export function buildScriptPayload(script: UnsavedScript, appId: `App.${string}`, appVersion: string): ScriptPayload {
  const { entrypoint: _entrypoint, ...rest } = script
  return { ...rest, appId, appVersion, scriptStorage: 'blob' }
}

export async function validateConnectScripts(
  options: { schema?: JsonSchema; fetchSchema?: typeof fetch } = {}
): Promise<ConnectConfigData> {
  const directory = process.cwd()
  const manifestPath = join(directory, CONFIG_FILE_NAME)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RawManifest
  const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { version?: unknown }
  const local = ConnectConfig.safeParse(manifest)
  const issues = new Map<string, string>()
  let schema = options.schema

  if (schema === undefined) {
    try {
      const response = await (options.fetchSchema ?? fetch)(CONNECT_SCRIPT_SCHEMA_URL, {
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      schema = (await response.json()) as JsonSchema
    } catch {
      console.warn(`Warning: could not fetch ${CONNECT_SCRIPT_SCHEMA_URL}; using the CLI schema.`)
    }
  }

  const scripts = local.success ? local.data.scripts : Array.isArray(manifest.scripts) ? manifest.scripts : []
  if (schema !== undefined) {
    validateAgainstServerSchema(schema, scripts, manifest.appId, packageJson.version, manifestPath, issues)
  }
  if (!local.success) addLocalIssues(local.error.issues, manifest, manifestPath, issues)

  if (issues.size > 0) throw new Error(`Connect validation failed:\n${[...issues.values()].join('\n')}`)
  if (!local.success) throw local.error
  return local.data
}

export async function runConnectValidation(): Promise<void> {
  const config = await validateConnectScripts()
  console.log(`Validated ${config.scripts.length} Connect script${config.scripts.length === 1 ? '' : 's'}`)
}

function validateAgainstServerSchema(
  schema: JsonSchema,
  scripts: unknown[],
  appId: unknown,
  appVersion: unknown,
  manifestPath: string,
  issues: Map<string, string>
): void {
  const variants = Array.isArray(schema.oneOf) ? (schema.oneOf as JsonSchema[]) : []
  const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true })
  scripts.forEach((rawScript, index) => {
    if (rawScript === null || typeof rawScript !== 'object' || Array.isArray(rawScript)) return
    const script = rawScript as Record<string, unknown>
    const variant = variants.find((candidate) => {
      const properties = candidate.properties as Record<string, JsonSchema> | undefined
      const types = properties?.type?.enum
      return Array.isArray(types) && types.includes(script.type)
    })
    if (!variant) return
    const validate = ajv.compile({
      ...(typeof schema.$schema === 'string' ? { $schema: schema.$schema } : {}),
      $defs: schema.$defs,
      ...variant,
    })
    const { entrypoint: _entrypoint, ...rest } = script
    validate({ ...rest, appId, appVersion, scriptStorage: 'blob' })
    for (const error of validate.errors ?? []) {
      const path = errorPath(error)
      const key = `${index}:${path}`
      if (!issues.has(key))
        issues.set(key, formatIssue(manifestPath, index, script, path, errorExpected(error), foundAt(script, path)))
    }
  })
}

function addLocalIssues(
  zodIssues: z.core.$ZodIssue[],
  manifest: RawManifest,
  manifestPath: string,
  issues: Map<string, string>
): void {
  for (const issue of zodIssues) {
    if (issue.path[0] !== 'scripts' || typeof issue.path[1] !== 'number') continue
    const index = issue.path[1]
    const path = pathFromParts(issue.path.slice(2))
    const key = `${index}:${path}`
    if (issues.has(key)) continue
    const script = Array.isArray(manifest.scripts) ? manifest.scripts[index] : undefined
    const record = script !== null && typeof script === 'object' ? (script as Record<string, unknown>) : {}
    const expected =
      'expected' in issue && typeof issue.expected === 'string' ? article(issue.expected) : 'a valid value'
    issues.set(key, formatIssue(manifestPath, index, record, path, expected, foundAt(record, path)))
  }
}

function errorPath(error: ErrorObject): string {
  const parts = error.instancePath
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (error.keyword === 'required') parts.push(String((error.params as { missingProperty: string }).missingProperty))
  return pathFromParts(parts)
}

function pathFromParts(parts: (PropertyKey | string)[]): string {
  return parts
    .map((part) => (typeof part === 'number' || /^\d+$/.test(String(part)) ? `[${String(part)}]` : `.${String(part)}`))
    .join('')
}

function errorExpected(error: ErrorObject): string {
  if (error.keyword === 'type') return article(String((error.params as { type: string }).type))
  if (error.keyword === 'enum' && error.instancePath.startsWith('/permissions/')) return 'a valid Terros permission'
  if (error.keyword === 'enum')
    return `one of ${(error.params as { allowedValues: unknown[] }).allowedValues.map((value) => JSON.stringify(value)).join(', ')}`
  if (error.keyword === 'required') {
    const parent = (error as ErrorObject & { parentSchema?: JsonSchema }).parentSchema
    const missing = (error.params as { missingProperty: string }).missingProperty
    const property = (parent?.properties as Record<string, JsonSchema> | undefined)?.[missing]
    return property?.type ? article(String(property.type)) : 'a required value'
  }
  return 'a valid value'
}

function formatIssue(
  manifestPath: string,
  index: number,
  script: Record<string, unknown>,
  path: string,
  expected: string,
  found: string
): string {
  const name = typeof script.name === 'string' ? script.name : `script ${index + 1}`
  return `${displayPath(manifestPath)} scripts[${index}] (${JSON.stringify(name)})${path}: expected ${expected}, got ${found}. ${example(path, expected)}`
}

function displayPath(path: string): string {
  const parts = path.split(sep)
  const integrations = parts.lastIndexOf('integrations')
  return integrations >= 0 ? parts.slice(integrations).join('/') : relative(process.cwd(), path) || basename(path)
}

function foundAt(script: Record<string, unknown>, path: string): string {
  const parts = [...path.matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)].map((match) => match[1] ?? Number(match[2]))
  let value: unknown = script
  for (const part of parts) {
    if (value === null || typeof value !== 'object' || !(part in value)) return 'missing'
    value = (value as Record<PropertyKey, unknown>)[part]
  }
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function article(type: string): string {
  return `${type === 'object' || type === 'array' ? 'an' : 'a'} ${type}`
}

function example(path: string, expected: string): string {
  if (path.startsWith('.permissions')) return 'For example: "permissions": ["account:list"].'
  if (path === '.dataType') return 'For example: "dataType": "Account".'
  if (path === '.authSchema') return 'For example: "authSchema": {}.'
  if (path === '.configSchema') return 'For example: "configSchema": [{ "name": "region", "type": "string" }].'
  const field = path.match(/\.([^.[\]]+)$/)?.[1] ?? 'field'
  const value = expected.includes('object') ? '{}' : expected.includes('array') ? '[]' : '"example"'
  return `For example: "${field}": ${value}.`
}
