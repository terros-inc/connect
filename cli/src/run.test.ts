import { runCli } from './run'
import { main } from './main'

vi.mock('./main', () => ({ main: vi.fn() }))

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
})

it('prints an API-history query failure and exits nonzero', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(main).mockRejectedValue(new Error('API history query failed: HIVE_S3_THROTTLING'))

  await runCli(['apiHistory', 'start', '--companyId', 'C:example'])

  expect(error).toHaveBeenCalledWith('API history query failed: HIVE_S3_THROTTLING')
  expect(process.exitCode).toBe(1)
})
