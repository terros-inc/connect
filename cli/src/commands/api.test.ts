import { loadEndpointsAfterRefresh } from '../loadEndpoints'
import { clearOpenApiCache } from '../cache'
import { apiCommands } from './api'

vi.mock('../cache', () => ({ clearOpenApiCache: vi.fn() }))
vi.mock('../loadEndpoints', () => ({ loadEndpointsAfterRefresh: vi.fn() }))

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

it.each([
  ['staging', '[staging] '],
  ['prod', ''],
])('labels refresh failures in %s', async (environment, prefix) => {
  vi.stubEnv('TERROS_ENV', environment)
  vi.stubEnv('TERROS_API_ENDPOINT', '')
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(loadEndpointsAfterRefresh).mockResolvedValue({ endpoints: {}, schemaStatus: 'failed' })
  try {
    await apiCommands.refresh.run()
    expect(error.mock.calls[0]?.[0]).toMatch(
      new RegExp(`^${prefix.replace(/[\[\]]/g, '\\$&')}The API schema could not be refreshed`)
    )
  } finally {
    error.mockRestore()
    vi.unstubAllEnvs()
  }
})
