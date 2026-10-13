import type { McpServerStackProps } from './stack.ts'

export type StageName = McpServerStackProps['stage']

type StageSettings = Pick<
  McpServerStackProps,
  | 'domainName'
  | 'apiBaseUrl'
  | 'auth0Issuer'
  | 'apiAudience'
  | 'tokenExchangeClientId'
  | 'tokenExchangeSecretName'
  | 'allowedOrigins'
  | 'certificateArn'
  | 'hostedZone'
  | 'alarmEmail'
>

/**
 * Auth0 settings shared by both stages. Staging and prod use one Auth0 tenant (tantalim), one login and one Terros API
 * audience, and one Machine to Machine application ("Terros MCP Server") performs the token exchange for both MCP
 * servers; only the MCP resource audience (each stage's own URL, from `domainName`) differs. `apiAudience` and
 * `tokenExchangeClientId` are not in the repo: pass the same values to both stages with `-c` (see docs/RUNBOOK.md).
 */
const SHARED: Partial<StageSettings> = { auth0Issuer: 'https://auth.terros.com/' }

/** Values known in the repo. Everything else is passed with `-c key=value` (see docs/RUNBOOK.md). */
const DEFAULTS: Record<StageName, Partial<StageSettings>> = {
  staging: {
    ...SHARED,
    domainName: 'mcp.staging.terros.com',
    // The shared M2M application's client secret, stored once per stage's deploy account (docs/RUNBOOK.md step 1.10).
    tokenExchangeSecretName: 'terros-mcp/staging/auth0-token-exchange',
  },
  prod: {
    ...SHARED,
    domainName: 'mcp.terros.com',
    apiBaseUrl: 'https://api.terros.com',
    tokenExchangeSecretName: 'terros-mcp/prod/auth0-token-exchange',
  },
}

export type ContextReader = (key: string) => string | undefined

export function resolveStage(read: ContextReader): StageSettings & { stage: StageName } {
  const stage = read('stage')
  if (stage !== 'staging' && stage !== 'prod') throw new Error('Pass -c stage=staging or -c stage=prod')
  const defaults = DEFAULTS[stage]
  const value = (key: keyof StageSettings): string | undefined => read(key) ?? (defaults[key] as string | undefined)
  const need = (key: keyof StageSettings): string => {
    const found = value(key)
    if (!found) throw new Error(`Missing -c ${key}=... for stage ${stage} (see docs/RUNBOOK.md)`)
    return found
  }

  const hostedZoneId = read('hostedZoneId')
  const zoneName = read('zoneName')
  return {
    stage,
    domainName: need('domainName'),
    apiBaseUrl: need('apiBaseUrl'),
    auth0Issuer: need('auth0Issuer'),
    apiAudience: need('apiAudience'),
    tokenExchangeClientId: need('tokenExchangeClientId'),
    tokenExchangeSecretName: need('tokenExchangeSecretName'),
    allowedOrigins: (read('allowedOrigins') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    certificateArn: read('certificateArn'),
    hostedZone: hostedZoneId && zoneName ? { hostedZoneId, zoneName } : undefined,
    alarmEmail: read('alarmEmail'),
  }
}
