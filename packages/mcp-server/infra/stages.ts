import type { McpServerStackProps } from './stack.ts'

export type StageName = McpServerStackProps['stage']

type StageSettings = Pick<
  McpServerStackProps,
  | 'domainName'
  | 'apiBaseUrl'
  | 'auth0Issuer'
  | 'auth0Audience'
  | 'allowedOrigins'
  | 'certificateArn'
  | 'hostedZone'
  | 'alarmEmail'
>

/** Values known in the repo. Everything else is passed with `-c key=value` (see docs/RUNBOOK.md). */
const DEFAULTS: Record<StageName, Partial<StageSettings>> = {
  staging: { domainName: 'mcp-staging.terros.com' },
  prod: { domainName: 'mcp.terros.com', apiBaseUrl: 'https://api.terros.com', auth0Issuer: 'https://auth.terros.com/' },
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
    auth0Audience: need('auth0Audience'),
    allowedOrigins: (read('allowedOrigins') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    certificateArn: read('certificateArn'),
    hostedZone: hostedZoneId && zoneName ? { hostedZoneId, zoneName } : undefined,
    alarmEmail: read('alarmEmail'),
  }
}
