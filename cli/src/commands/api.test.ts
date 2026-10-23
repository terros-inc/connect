import { loadEndpoints } from '../loadEndpoints'
import { clearOpenApiCache } from '../cache'
import { apiCommands } from './api'

vi.mock('../cache', () => ({ clearOpenApiCache: vi.fn() }))
vi.mock('../loadEndpoints', () => ({ loadEndpoints: vi.fn() }))

it('refreshes the API schema and tells the user to retry the endpoint', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  await apiCommands.refresh.run()

  expect(clearOpenApiCache).toHaveBeenCalledOnce()
  expect(loadEndpoints).toHaveBeenCalledOnce()
  expect(log).toHaveBeenCalledWith(
    'API schema refreshed. Retry the endpoint command. If it is still unavailable, check whether it appears in the API schema and is available to your account.'
  )
  log.mockRestore()
})
