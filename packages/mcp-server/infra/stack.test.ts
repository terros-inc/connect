import { Code } from 'aws-cdk-lib/aws-lambda'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { App } from 'aws-cdk-lib'
import { resolveStage } from './stages.ts'
import { McpServerStack, type McpServerStackProps } from './stack.ts'

function synth(overrides: Partial<McpServerStackProps> = {}): Template {
  const app = new App()
  const stack = new McpServerStack(app, 'Test', {
    stage: 'prod',
    domainName: 'mcp.example.test',
    apiBaseUrl: 'https://api.example.test',
    auth0Issuer: 'https://auth.example.test/',
    apiAudience: 'https://api.example.test',
    tokenExchangeClientId: 'exchange-client',
    tokenExchangeSecretName: 'terros-mcp/test/auth0-token-exchange',
    allowedOrigins: [],
    code: Code.fromInline('export const handler = async () => ({})'),
    version: '1.0.0',
    hostedZone: { hostedZoneId: 'Z0000000000EXAMPLE', zoneName: 'example.test' },
    env: { account: '000000000000', region: 'us-east-1' },
    ...overrides,
  })
  return Template.fromStack(stack)
}

const template = synth()

it('configures the function per request, with no server-wide API key', () => {
  const functions = template.findResources('AWS::Lambda::Function')
  const [fn] = Object.values(functions)
  const variables = fn!.Properties.Environment.Variables as Record<string, string>
  expect(variables).toMatchObject({
    MCP_RESOURCE_URL: 'https://mcp.example.test',
    TERROS_API_ENDPOINT: 'https://api.example.test',
    AUTH0_ISSUER: 'https://auth.example.test/',
    TERROS_API_AUDIENCE: 'https://api.example.test',
    AUTH0_TOKEN_EXCHANGE_CLIENT_ID: 'exchange-client',
    AUTH0_TOKEN_EXCHANGE_SECRET_ID: 'terros-mcp/test/auth0-token-exchange',
  })
  expect(variables).not.toHaveProperty('TERROS_API_KEY')
  expect(fn!.Properties).toMatchObject({ Runtime: 'nodejs24.x', Handler: 'lambda.handler' })
})

it('lets the function read only the token exchange secret', () => {
  const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'))
  expect(policies).toContain('secretsmanager:GetSecretValue')
  expect(policies).toContain(':secret:terros-mcp/test/auth0-token-exchange-??????')
})

it('serves the MCP server at the root of the custom domain', () => {
  template.hasOutput('McpUrl', { Value: 'https://mcp.example.test' })
})

it('serves only through the custom domain', () => {
  template.hasResourceProperties('AWS::ApiGateway::RestApi', { DisableExecuteApiEndpoint: true })
  template.hasResourceProperties('AWS::ApiGateway::DomainName', {
    DomainName: 'mcp.example.test',
    SecurityPolicy: 'TLS_1_2',
  })
  template.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'mcp.example.test' })
  template.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'mcp.example.test.', Type: 'A' })
})

it('blocks other Host headers and disallowed browser origins at the gateway', () => {
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'REGIONAL',
    DefaultAction: { Allow: {} },
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: 'block-unexpected-host',
        Action: { Block: {} },
        Statement: {
          NotStatement: {
            Statement: {
              ByteMatchStatement: Match.objectLike({
                FieldToMatch: { SingleHeader: { Name: 'host' } },
                PositionalConstraint: 'EXACTLY',
                SearchString: 'mcp.example.test',
              }),
            },
          },
        },
      }),
      Match.objectLike({ Name: 'block-disallowed-origin', Action: { Block: {} } }),
    ]),
  })
  template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1)
})

it('allowlists extra origins alongside its own', () => {
  const statements = synth({ allowedOrigins: ['app.example.test'] }).findResources('AWS::WAFv2::WebACL')
  const rules = Object.values(statements)[0]!.Properties.Rules as { Name: string; Statement: unknown }[]
  const origin = JSON.stringify(rules.find((rule) => rule.Name === 'block-disallowed-origin'))
  expect(origin).toContain('https://mcp.example.test')
  expect(origin).toContain('https://app.example.test')
})

it('writes access and function logs with retention', () => {
  template.resourceCountIs('AWS::Logs::LogGroup', 2)
  template.allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 180 })
  template.hasResourceProperties('AWS::ApiGateway::Stage', {
    AccessLogSetting: Match.objectLike({ DestinationArn: Match.anyValue() }),
  })
})

it('health-checks /health and alarms on it, errors, throttles, 5xx and latency', () => {
  template.hasResourceProperties('AWS::Route53::HealthCheck', {
    HealthCheckConfig: Match.objectLike({
      Type: 'HTTPS',
      FullyQualifiedDomainName: 'mcp.example.test',
      ResourcePath: '/health',
    }),
  })
  const names = Object.values(template.findResources('AWS::CloudWatch::Alarm')).map(
    (alarm) => alarm.Properties.AlarmName
  )
  expect(names.sort()).toEqual(
    ['Api5xx', 'ApiLatencyP95', 'FunctionErrors', 'FunctionThrottles', 'HealthCheckFailing'].map(
      (name) => `terros-mcp-prod-${name}`
    )
  )
  template.allResourcesProperties('AWS::CloudWatch::Alarm', {
    AlarmActions: [Match.objectLike({ Ref: Match.anyValue() })],
  })
})

it('uses a provided certificate without managing DNS', () => {
  const manual = synth({
    hostedZone: undefined,
    certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000',
  })
  manual.resourceCountIs('AWS::CertificateManager::Certificate', 0)
  manual.resourceCountIs('AWS::Route53::RecordSet', 0)
})

it('requires a certificate source', () => {
  expect(() => synth({ hostedZone: undefined })).toThrow('hostedZone or certificateArn')
})

describe('resolveStage', () => {
  it('fills prod defaults and requires the token exchange settings', () => {
    const context: Record<string, string> = { stage: 'prod' }
    expect(() => resolveStage((key) => context[key])).toThrow('apiAudience')
    context.apiAudience = 'https://api.example.test'
    expect(() => resolveStage((key) => context[key])).toThrow('tokenExchangeClientId')
    context.tokenExchangeClientId = 'exchange-client'
    expect(resolveStage((key) => context[key])).toMatchObject({
      stage: 'prod',
      domainName: 'mcp.terros.com',
      apiBaseUrl: 'https://api.terros.com',
      auth0Issuer: 'https://auth.terros.com/',
      tokenExchangeSecretName: 'terros-mcp/prod/auth0-token-exchange',
    })
  })

  it('requires staging values that are not in the repo', () => {
    expect(() => resolveStage((key) => ({ stage: 'staging' })[key])).toThrow('apiBaseUrl')
  })

  it('serves staging at mcp.staging.terros.com', () => {
    const context: Record<string, string> = {
      stage: 'staging',
      apiBaseUrl: 'https://api.example.test',
      auth0Issuer: 'https://auth.example.test/',
      apiAudience: 'https://api.example.test',
      tokenExchangeClientId: 'exchange-client',
    }
    expect(resolveStage((key) => context[key])).toMatchObject({
      stage: 'staging',
      domainName: 'mcp.staging.terros.com',
      tokenExchangeSecretName: 'terros-mcp/staging/auth0-token-exchange',
    })
  })

  it('rejects an unknown stage', () => {
    expect(() => resolveStage(() => undefined)).toThrow('-c stage=')
  })
})
