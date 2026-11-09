import minimist from 'minimist'
import { loadEndpointsAfterRefresh } from '../loadEndpoints'
import { clearOpenApiCache } from '../cache'
import { getTokens } from '../../../packages/connect-common/src/oauth/tokens'
import { apiCommands } from './api'

vi.mock('../cache', () => ({ clearOpenApiCache: vi.fn() }))
vi.mock('../loadEndpoints', () => ({ loadEndpointsAfterRefresh: vi.fn() }))
vi.mock('../../../packages/connect-common/src/oauth/tokens', () => ({ getTokens: vi.fn() }))

beforeEach(() => {
  process.exitCode = undefined
  vi.resetAllMocks()
})

it('reports a successful refresh only when the schema was fetched', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({ endpoints: {}, schemaStatus: 'available' })

  await apiCommands.refresh.run()

  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(loadEndpointsAfterRefresh).toHaveBeenCalledOnce()
  expect(log).toHaveBeenCalledOnce()
  expect(process.exitCode).toBeUndefined()
  log.mockRestore()
})

it('does not report success when the schema could not be refreshed', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({ endpoints: {}, schemaStatus: 'failed' })

  await apiCommands.refresh.run()

  expect(error).toHaveBeenCalledOnce()
  expect(log).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(1)
  error.mockRestore()
  log.mockRestore()
})

describe('terros api call', () => {
  const accessToken = 'saved-access-token'
  const fetch = vi.fn()
  let log: ReturnType<typeof vi.spyOn>
  const run = (argv: string[]): Promise<void> => {
    const params = minimist(argv)
    return apiCommands.call.run({ params, args: params._.map(String) })
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('TERROS_API_KEY', '')
    vi.stubEnv('TERROS_IMPERSONATE', '')
    vi.stubEnv('TERROS_API_ENDPOINT', 'api.staging.example.test')
    vi.mocked(getTokens).mockResolvedValue({ access_token: accessToken, refresh_token: 'saved-refresh-token' })
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    log.mockRestore()
  })

  // The command exists for endpoints the schema lacks, so it must reach the host and login the other commands use.
  it('posts the body to the configured host as the signed-in user and prints the response', async () => {
    fetch.mockResolvedValue(Response.json({ type: 'success', company: { name: 'Acme Solar', uploadIconUrl: 'x' } }))

    await run(['/app/example/update', '--body', '{"version":"1.2.3"}'])

    expect(fetch).toHaveBeenCalledWith('https://api.staging.example.test/app/example/update', {
      method: 'POST',
      headers: expect.objectContaining({ authorization: `Bearer ${accessToken}` }),
      body: '{"version":"1.2.3"}',
    })
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({ type: 'success', company: { name: 'Acme Solar' } })
  })

  // A failure must reach runCli, which exits 1, and its message is printed, so it must never carry the token.
  it.each([
    ['an HTTP error', () => fetch.mockResolvedValue(new Response('{}', { status: 404, statusText: 'Not Found' }))],
    ['a network error', () => fetch.mockRejectedValue(new TypeError('fetch failed'))],
    ['an API error', () => fetch.mockResolvedValue(Response.json({ type: 'error', error: 'NotFound' }))],
  ])('fails on %s without printing the token', async (_, respond) => {
    respond()
    const failure = await run(['/app/example/update']).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).not.toContain(accessToken)
    expect(log).not.toHaveBeenCalled()
  })
})
