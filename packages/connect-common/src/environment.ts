import { join } from 'node:path'
import { homedir } from 'node:os'

type TerrosEnvironment = {
  /** `prod`, `staging`, a developer's own stack name as the mobile apps' environment picker names it, or `localhost`. */
  name: string
  /** The API base URL. */
  baseUrl: string
  /** Where the sign-in and cached schemas live. Production keeps the original location so customers see no change. */
  stateDir: string
}

const STAGE_NAME = /^[a-z][a-z0-9-]*$/
const STACK_HOST = /^api\.([a-z][a-z0-9-]*)\.terros\.com$/

/**
 * Picks the backend from `TERROS_ENV` (the CLI's `--env` flag sets it) or `TERROS_API_ENDPOINT`. Only Terros hosts
 * (`https://api.terros.com`, `https://api.<stage>.terros.com`) and `http://localhost` are accepted, because every
 * environment sends its own saved sign-in or API key to its host and nothing else may receive one. A stack other than
 * production gets its own state directory, so a staging sign-in or schema is never sent to production, nor the reverse.
 */
export function resolveEnvironment(env: NodeJS.ProcessEnv = process.env): TerrosEnvironment {
  const selected = env.TERROS_ENV?.trim().toLowerCase()
  // A whitespace-only value is a mistake, not "unset": falling through would run the command against production.
  if (env.TERROS_ENV && !selected)
    throw new Error('TERROS_ENV (or --env) is blank. Use prod, staging, or a stack name.')
  if (selected && !STAGE_NAME.test(selected)) {
    throw new Error(`Unknown environment "${selected}". Use prod, staging, or a developer stack name such as "alex".`)
  }
  const endpoint = env.TERROS_API_ENDPOINT?.trim()
  const backend = endpoint ? parseEndpoint(endpoint) : { name: selected || 'prod' }
  if (
    selected &&
    (backend.name !== selected ||
      ('baseUrl' in backend &&
        backend.baseUrl !== (selected === 'prod' ? 'https://api.terros.com' : `https://api.${selected}.terros.com`)))
  ) {
    throw new Error('TERROS_ENV (or --env) conflicts with TERROS_API_ENDPOINT: they pick different backends.')
  }
  const configDir = join(homedir(), '.config', 'terros')
  const { name } = backend
  return {
    name,
    baseUrl:
      'baseUrl' in backend
        ? backend.baseUrl
        : name === 'prod'
          ? 'https://api.terros.com'
          : `https://api.${name}.terros.com`,
    stateDir:
      name === 'prod'
        ? configDir
        : 'baseUrl' in backend && backend.baseUrl.startsWith('http://localhost')
          ? join(configDir, 'env', 'localhost', `port-${new URL(backend.baseUrl).port || '80'}`)
          : join(configDir, 'env', name),
  }
}

function parseEndpoint(endpoint: string): { name: string; baseUrl: string } {
  const unsupported = new Error(
    `Unsupported API host "${endpoint}". Use https://api.terros.com, https://api.<stage>.terros.com or http://localhost.`
  )
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`)
  } catch {
    throw unsupported
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw unsupported
  if (url.protocol === 'http:' && url.hostname === 'localhost') return { name: 'localhost', baseUrl: url.origin }
  if (url.protocol !== 'https:' || url.port) throw unsupported
  if (url.hostname === 'api.terros.com') return { name: 'prod', baseUrl: url.origin }
  const stage = STACK_HOST.exec(url.hostname)?.[1]
  if (!stage || stage === 'prod') throw unsupported
  return { name: stage, baseUrl: url.origin }
}

export function environmentApiKeyVariable(environment: TerrosEnvironment): string {
  const url = new URL(environment.baseUrl)
  if (url.protocol === 'http:') return `TERROS_API_KEY_PORT_${url.port || '80'}`
  return environment.name === 'prod'
    ? 'TERROS_API_KEY'
    : `TERROS_API_KEY_STAGE_${environment.name.toUpperCase().replaceAll('-', '_')}`
}

export function environmentApiKey(
  environment: TerrosEnvironment,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return env[environmentApiKeyVariable(environment)]
}

/** Non-production environments have no Auth0 tenant of their own, so a production sign-in must never stand in for one. */
export function interactiveSignInRefusal(environment: TerrosEnvironment): string | undefined {
  if (environment.name === 'prod') return undefined
  return `Interactive sign-in is only available for production, because ${environment.name} has no sign-in of its own and a production sign-in would be a production credential. Use an API key: set ${environmentApiKeyVariable(environment)}.`
}
