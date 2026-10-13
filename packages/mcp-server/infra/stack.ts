import type { Construct } from 'constructs'
import * as wafv2 from 'aws-cdk-lib/aws-wafv2'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'

export type McpServerStackProps = StackProps & {
  stage: 'staging' | 'prod'
  /** Public hostname, per stage in infra/stages.ts (mcp.staging.terros.com, mcp.terros.com). The MCP server is served at the root, https://<domainName>, which is also the Auth0 audience. */
  domainName: string
  apiBaseUrl: string
  auth0Issuer: string
  /** Auth0 API identifier of the Terros API, the audience the token exchange asks for. */
  apiAudience: string
  /** Client ID of the Auth0 application that performs the token exchange. */
  tokenExchangeClientId: string
  /** Name of the Secrets Manager secret holding that application's client secret (created by a person, see the runbook). */
  tokenExchangeSecretName: string
  /** Extra browser origin hostnames allowed besides the server's own. */
  allowedOrigins: string[]
  /** Lambda code: the `dist` directory produced by `pnpm package`. */
  code: lambda.Code
  version: string
  /** Route 53 zone to create the certificate and alias record in. Without it, `certificateArn` is required and DNS is manual. */
  hostedZone?: { hostedZoneId: string; zoneName: string }
  certificateArn?: string
  /** Email subscribed to the alarm topic. */
  alarmEmail?: string
}

/**
 * Hosted remote MCP server: API Gateway (regional REST API on a custom domain, execute-api endpoint disabled,
 * WAF host/origin rules) in front of a stateless Lambda, with access and function logs, a Route 53 health check,
 * and CloudWatch alarms.
 */
export class McpServerStack extends Stack {
  constructor(scope: Construct, id: string, props: McpServerStackProps) {
    super(scope, id, props)
    const prod = props.stage === 'prod'
    const retention = prod ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_MONTH
    const removalPolicy = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    const resourceUrl = `https://${props.domainName}`

    const functionLogs = new logs.LogGroup(this, 'FunctionLogs', { retention, removalPolicy })
    const fn = new lambda.Function(this, 'Function', {
      description: `Terros remote MCP server (${props.stage})`,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'lambda.handler',
      code: props.code,
      memorySize: 1024,
      // API Gateway REST integrations time out at 29 seconds by default, so a longer function timeout would not help.
      timeout: Duration.seconds(29),
      logGroup: functionLogs,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        MCP_RESOURCE_URL: resourceUrl,
        MCP_SERVER_VERSION: props.version,
        MCP_ALLOWED_ORIGINS: props.allowedOrigins.join(','),
        TERROS_API_ENDPOINT: props.apiBaseUrl,
        AUTH0_ISSUER: props.auth0Issuer,
        TERROS_API_AUDIENCE: props.apiAudience,
        AUTH0_TOKEN_EXCHANGE_CLIENT_ID: props.tokenExchangeClientId,
        AUTH0_TOKEN_EXCHANGE_SECRET_ID: props.tokenExchangeSecretName,
      },
    })
    secretsmanager.Secret.fromSecretNameV2(this, 'TokenExchangeSecret', props.tokenExchangeSecretName).grantRead(fn)

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', { retention, removalPolicy })
    const api = new apigateway.LambdaRestApi(this, 'Api', {
      restApiName: `terros-mcp-${props.stage}`,
      handler: fn,
      proxy: true,
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
      // Only the custom domain reaches the function, so the Host is always ours.
      disableExecuteApiEndpoint: true,
      binaryMediaTypes: [],
      deployOptions: {
        stageName: 'live',
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        metricsEnabled: true,
        throttlingRateLimit: prod ? 200 : 20,
        throttlingBurstLimit: prod ? 400 : 40,
      },
    })

    const zone = props.hostedZone
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', props.hostedZone)
      : undefined
    let certificate: acm.ICertificate
    if (props.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)
    } else if (zone) {
      certificate = new acm.Certificate(this, 'Certificate', {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      })
    } else {
      throw new Error('Either hostedZone or certificateArn is required')
    }
    const domain = new apigateway.DomainName(this, 'Domain', {
      domainName: props.domainName,
      certificate,
      endpointType: apigateway.EndpointType.REGIONAL,
      securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
      mapping: api,
    })
    if (zone) {
      new route53.ARecord(this, 'Alias', {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(domain)),
      })
    }

    this.addGatewayProtections(api, props)

    const healthCheck = new route53.CfnHealthCheck(this, 'HealthCheck', {
      healthCheckConfig: {
        type: 'HTTPS',
        fullyQualifiedDomainName: props.domainName,
        port: 443,
        resourcePath: '/health',
        requestInterval: 30,
        failureThreshold: 3,
      },
      healthCheckTags: [{ key: 'Name', value: `terros-mcp-${props.stage}` }],
    })

    const topic = new sns.Topic(this, 'Alarms', { displayName: `Terros MCP server (${props.stage}) alarms` })
    if (props.alarmEmail) topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail))
    const alarm = (id: string, options: cloudwatch.AlarmProps): void => {
      const created = new cloudwatch.Alarm(this, id, {
        ...options,
        alarmName: `terros-mcp-${props.stage}-${id}`,
        treatMissingData: options.treatMissingData ?? cloudwatch.TreatMissingData.NOT_BREACHING,
      })
      created.addAlarmAction(new actions.SnsAction(topic))
      created.addOkAction(new actions.SnsAction(topic))
    }

    alarm('HealthCheckFailing', {
      alarmDescription: `GET https://${props.domainName}/health is failing from Route 53 health checkers`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Route53',
        metricName: 'HealthCheckStatus',
        dimensionsMap: { HealthCheckId: healthCheck.attrHealthCheckId },
        statistic: 'Minimum',
        period: Duration.minutes(1),
      }),
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    alarm('FunctionErrors', {
      alarmDescription: 'The MCP Lambda threw (crash, timeout or unhandled error)',
      metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: prod ? 5 : 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
    alarm('FunctionThrottles', {
      alarmDescription: 'The MCP Lambda is being throttled',
      metric: fn.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
    alarm('Api5xx', {
      alarmDescription: 'API Gateway is returning 5xx responses',
      metric: api.metricServerError({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: prod ? 5 : 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
    alarm('ApiLatencyP95', {
      alarmDescription: 'p95 latency is above 10 seconds',
      metric: api.metricLatency({ period: Duration.minutes(5), statistic: 'p95' }),
      threshold: 10_000,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    })

    if (!Stack.of(this).region.startsWith('${') && Stack.of(this).region !== 'us-east-1') {
      Annotations.of(this).addWarning('Route 53 health check metrics exist only in us-east-1; deploy this stack there')
    }

    new CfnOutput(this, 'McpUrl', { value: resourceUrl })
    new CfnOutput(this, 'DomainTarget', {
      description: `CNAME target for ${props.domainName} when DNS is not managed by this stack`,
      value: domain.domainNameAliasDomainName,
    })
    new CfnOutput(this, 'FunctionLogGroup', { value: functionLogs.logGroupName })
    new CfnOutput(this, 'AccessLogGroup', { value: accessLogs.logGroupName })
    new CfnOutput(this, 'HealthCheckId', { value: healthCheck.attrHealthCheckId })
    new CfnOutput(this, 'AlarmTopicArn', { value: topic.topicArn })
  }

  /**
   * DNS-rebinding and cross-site protection at the gateway: only our own Host, and a browser Origin only when
   * allowlisted. Requests without an Origin header (Claude, Cursor and other non-browser clients) are unaffected.
   */
  private addGatewayProtections(api: apigateway.RestApi, props: McpServerStackProps): void {
    const visibility = (metricName: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      metricName: `terros-mcp-${props.stage}-${metricName}`,
      sampledRequestsEnabled: true,
    })
    const lowercase = [{ priority: 0, type: 'LOWERCASE' }]
    const headerEquals = (name: string, value: string): wafv2.CfnWebACL.StatementProperty => ({
      byteMatchStatement: {
        fieldToMatch: { singleHeader: { Name: name } },
        positionalConstraint: 'EXACTLY',
        searchString: value.toLowerCase(),
        textTransformations: lowercase,
      },
    })
    const origins = [...new Set([props.domainName, ...props.allowedOrigins])].map((host) =>
      headerEquals('origin', `https://${host}`)
    )

    const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('acl'),
      rules: [
        {
          name: 'block-unexpected-host',
          priority: 0,
          action: { block: {} },
          visibilityConfig: visibility('unexpected-host'),
          statement: { notStatement: { statement: headerEquals('host', props.domainName) } },
        },
        {
          name: 'block-disallowed-origin',
          priority: 1,
          action: { block: {} },
          visibilityConfig: visibility('disallowed-origin'),
          statement: {
            andStatement: {
              statements: [
                {
                  // Matches only when an Origin header is present.
                  byteMatchStatement: {
                    fieldToMatch: {
                      headers: {
                        matchPattern: { includedHeaders: ['origin'] },
                        matchScope: 'KEY',
                        oversizeHandling: 'MATCH',
                      },
                    },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'origin',
                    textTransformations: lowercase,
                  },
                },
                {
                  notStatement: {
                    statement: origins.length === 1 ? origins[0]! : { orStatement: { statements: origins } },
                  },
                },
              ],
            },
          },
        },
      ],
    })
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: acl.attrArn,
    })
  }
}
