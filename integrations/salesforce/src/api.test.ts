import { IntegrationError } from '@terros-inc/sdk'
import { addLead } from './api.ts'

const lead = { FirstName: 'Quinn', LastName: 'Example', Email: '', Company: 'Acme Solar' }

function tokenFailure(status: number, statusText: string): Response {
  const body = { error: 'invalid_client', error_description: 'invalid client credentials' }
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('addLead access token', () => {
  // Bad or revoked client credentials fail every run until the customer fixes them: thrown as a plain Error they alarm
  // Terros on-call, while a Salesforce outage thrown as an IntegrationError would be hidden from it.
  test.each([
    { status: 400, statusText: 'Bad Request', integration: true },
    { status: 401, statusText: 'Unauthorized', integration: true },
    { status: 429, statusText: 'Too Many Requests', integration: false },
    { status: 503, statusText: 'Service Unavailable', integration: false },
  ])(
    'fails a $status token response as an integration error: $integration',
    async ({ status, statusText, integration }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenFailure(status, statusText)))
      const config = { clientId: `client-${status}`, clientSecret: 'secret', url: 'https://example.my.salesforce.com' }

      const error = await addLead(config, lead).catch((caught: unknown) => caught)

      expect(error).toMatchObject({ message: `Error getting access token: ${status} ${statusText}` })
      expect(error instanceof IntegrationError).toBe(integration)
    }
  )
})
