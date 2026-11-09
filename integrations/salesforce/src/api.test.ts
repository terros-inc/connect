import { IntegrationError } from '@terros-inc/sdk'
import { addLead } from './api.ts'

const lead = { FirstName: 'Quinn', LastName: 'Example', Email: '', Company: 'Acme Solar' }

function tokenFailure(status: number, statusText: string, body: string): Response {
  return new Response(body, { status, statusText, headers: { 'Content-Type': 'application/json' } })
}

function oauthError(error: string, description: string): string {
  return JSON.stringify({ error, error_description: description })
}

afterEach(() => vi.unstubAllGlobals())

describe('addLead access token', () => {
  // Bad or revoked client credentials fail every run until the customer fixes them: thrown as a plain Error they alarm
  // Terros on-call, while a Salesforce outage or a malformed Terros request thrown as an IntegrationError would be hidden
  // from it. Each message must carry Salesforce's reason, or ops can't tell bad credentials from a wrong url or a bug.
  test.each([
    {
      status: 400,
      statusText: 'Bad Request',
      body: oauthError('invalid_client', 'invalid client credentials'),
      message: '400 Bad Request (invalid_client: invalid client credentials). Salesforce rejected this install',
      integration: true,
    },
    {
      status: 400,
      statusText: 'Bad Request',
      body: oauthError('invalid_grant', 'no client credentials user enabled'),
      message: '400 Bad Request (invalid_grant: no client credentials user enabled). Salesforce rejected this install',
      integration: true,
    },
    {
      status: 404,
      statusText: 'Not Found',
      body: '<html>URL No Longer Exists</html>',
      message: '404 Not Found. Salesforce rejected this install',
      integration: true,
    },
    {
      status: 400,
      statusText: 'Bad Request',
      body: oauthError('unsupported_grant_type', 'grant type not supported'),
      message:
        '400 Bad Request (unsupported_grant_type: grant type not supported). Salesforce rejected the token request Terros sent',
      integration: false,
    },
    {
      status: 429,
      statusText: 'Too Many Requests',
      body: '',
      message: '429 Too Many Requests. Salesforce did not',
      integration: false,
    },
    {
      status: 503,
      statusText: 'Service Unavailable',
      body: '{}',
      message: '503 Service Unavailable. Salesforce did not',
      integration: false,
    },
  ])(
    'fails a $status $body token response as an integration error: $integration',
    async ({ status, statusText, body, message, integration }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenFailure(status, statusText, body)))
      const config = {
        clientId: `client-${status}-${body}`,
        clientSecret: 'shh-secret',
        url: 'https://example.my.salesforce.com',
      }

      const error = await addLead(config, lead).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      const { message: actual } = error as Error
      expect(actual).toContain(`Error getting access token: ${message}`)
      expect(actual).not.toContain('shh-secret')
      expect(error instanceof IntegrationError).toBe(integration)
    }
  )
})
