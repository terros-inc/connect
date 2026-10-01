import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { getTokens } from '@terros-inc/connect-common/auth'
import { clearRuntimeCaches } from '../cache'
import { buildTerrosClient } from '../api/query'
import { parseEndpoints } from './parser'
import { loadInternalSchema } from './internal'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.path,
}))
vi.mock('@terros-inc/connect-common/auth', () => ({ getTokens: vi.fn() }))
vi.mock('../api/query', () => ({ buildTerrosClient: vi.fn() }))

const call = vi.fn()
const get = vi.fn()
const schema = {
  openapi: '3.1.1',
  paths: {
    '/company/list': {
      post: {
        summary: 'List companies',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
  },
  components: { schemas: {} },
}
const day = 24 * 60 * 60 * 1000

beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('TERROS_API_KEY', '')
  vi.stubEnv('TERROS_API_ENDPOINT', '')
  vi.stubEnv('TERROS_IMPERSONATE', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  home.path = await mkdtemp(join(tmpdir(), 'terros-schema-'))
  vi.mocked(getTokens).mockResolvedValue({
    access_token: 'access',
    refresh_token: 'refresh',
    id_token: undefined,
    token_type: 'Bearer',
    expires_at: Date.now() + day,
  })
  vi.mocked(buildTerrosClient).mockReturnValue({ call, get } as unknown as ReturnType<typeof buildTerrosClient>)
  call.mockResolvedValue({ type: 'success', user: { userId: 'U:1' }, company: { companyId: 'C:tantalim' } })
  get.mockResolvedValue(schema)
})

afterEach(async () => {
  await rm(home.path, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('loads the JSON internal schema and caches the full profile and schema privately', async () => {
  const result = await loadInternalSchema()
  expect(parseEndpoints(result!)).toHaveProperty('company.list.path', '/company/list')
  expect(call).toHaveBeenCalledWith('user/profile', {})
  expect(get).toHaveBeenCalledWith('openapi')
  const directory = join(home.path, '.config', 'terros')
  const profile = JSON.parse(await readFile(join(directory, 'profile.json'), 'utf8'))
  expect(profile.data.user.userId).toBe('U:1')
  expect(profile.key).not.toContain('refresh')
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
  expect((await stat(join(directory, 'profile.json'))).mode & 0o777).toBe(0o600)
  expect((await stat(join(directory, 'openapi.json'))).mode & 0o777).toBe(0o600)
})

it('reuses caches before 24 hours and refreshes both at exactly 24 hours', async () => {
  const now = Date.now()
  await loadInternalSchema()
  vi.mocked(Date.now).mockReturnValue(now + day - 1)
  await loadInternalSchema()
  expect(call).toHaveBeenCalledTimes(1)
  expect(get).toHaveBeenCalledTimes(1)
  vi.mocked(Date.now).mockReturnValue(now + day)
  await loadInternalSchema()
  expect(call).toHaveBeenCalledTimes(2)
  expect(get).toHaveBeenCalledTimes(2)
})

it.each([
  { type: 'success', isTantalim: true, company: { companyId: 'C:customer' } },
  { type: 'success', company: { companyId: 'C:customer' } },
])('keeps non-internal users on the bundled schema', async (profile) => {
  call.mockResolvedValue(profile)
  expect(await loadInternalSchema()).toBeUndefined()
  expect(get).not.toHaveBeenCalled()
})

it('identifies internal users by company ID regardless of the flag', async () => {
  call.mockResolvedValue({ type: 'success', isTantalim: false, company: { companyId: 'C:tantalim' } })
  expect(await loadInternalSchema()).toBe(JSON.stringify(schema))
})

it('does not fetch a profile or schema without authentication', async () => {
  vi.mocked(getTokens).mockResolvedValue(null)
  expect(await loadInternalSchema()).toBeUndefined()
  expect(call).not.toHaveBeenCalled()
  expect(get).not.toHaveBeenCalled()
})

it.each(['TERROS_API_KEY', 'TERROS_API_ENDPOINT', 'TERROS_IMPERSONATE'])(
  'partitions caches when %s changes',
  async (variable) => {
    await loadInternalSchema()
    vi.stubEnv(variable, 'different')
    call.mockResolvedValue({ type: 'success', company: { companyId: 'C:customer' } })
    expect(await loadInternalSchema()).toBeUndefined()
    expect(call).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledTimes(1)
  }
)

it('does not share caches with another login', async () => {
  await loadInternalSchema()
  vi.mocked(getTokens).mockResolvedValue({
    access_token: 'other',
    refresh_token: 'other',
    id_token: undefined,
    token_type: 'Bearer',
    expires_at: Date.now() + day,
  })
  call.mockResolvedValue({ type: 'success', company: { companyId: 'C:customer' } })
  expect(await loadInternalSchema()).toBeUndefined()
  expect(call).toHaveBeenCalledTimes(2)
})

it('refreshes corrupt cached documents', async () => {
  await loadInternalSchema()
  const directory = join(home.path, '.config', 'terros')
  await writeFile(join(directory, 'profile.json'), '{')
  const cached = JSON.parse(await readFile(join(directory, 'openapi.json'), 'utf8'))
  await writeFile(join(directory, 'openapi.json'), JSON.stringify({ ...cached, data: { invalid: true } }))
  await loadInternalSchema()
  expect(call).toHaveBeenCalledTimes(2)
  expect(get).toHaveBeenCalledTimes(2)
})

it('falls back without reusing an expired internal profile when refresh fails', async () => {
  await loadInternalSchema()
  vi.mocked(Date.now).mockReturnValue(Date.now() + day)
  call.mockRejectedValue(new Error('Offline'))
  expect(await loadInternalSchema()).toBeUndefined()
  expect(get).toHaveBeenCalledTimes(1)
})

it('rejects invalid downloaded schemas without caching them', async () => {
  get.mockResolvedValue({ type: 'error' })
  expect(await loadInternalSchema()).toBeUndefined()
  await expect(readFile(join(home.path, '.config', 'terros', 'openapi.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('clears both runtime caches for login', async () => {
  await loadInternalSchema()
  await clearRuntimeCaches()
  await loadInternalSchema()
  expect(call).toHaveBeenCalledTimes(2)
  expect(get).toHaveBeenCalledTimes(2)
})
