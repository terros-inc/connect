import { whoamiCommand } from './whoami'

const staff = {
  user: { userId: 'U.example-staff', firstName: 'Sam', lastName: 'Staff' },
  company: { companyId: 'C.example-internal', name: 'Example Internal' },
}
const jane = {
  user: { userId: 'U.example-jane', firstName: 'Janet', preferredName: ' Jane ', lastName: 'Doe' },
  company: { companyId: 'C.example-acme', name: 'Acme Solar' },
}
const profiles: Record<string, typeof staff> = { [jane.user.userId]: jane }

// The API answers /user/profile as the impersonated user when the header names one, else as the signed-in user.
const fetchProfile = vi.fn(async (_url: string, init: RequestInit) => {
  const impersonated = (init.headers as Record<string, string | undefined>).impersonate_user_id
  const profile = (impersonated && profiles[impersonated]) || staff
  return { ok: true, json: async () => ({ type: 'success', ...profile }) }
})

async function whoami(): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await whoamiCommand.run()
  return log.mock.calls.map((args) => args.join(' ')).join('\n')
}

beforeEach(() => {
  vi.restoreAllMocks()
  fetchProfile.mockClear()
  vi.stubGlobal('fetch', fetchProfile)
  vi.stubEnv('TERROS_API_KEY', 'test-key')
  vi.stubEnv('TERROS_API_ENDPOINT', 'https://api.example.test')
  vi.stubEnv('TERROS_IMPERSONATE', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('prints the signed-in user with one profile call when not impersonating', async () => {
  await expect(whoami()).resolves.toBe(
    [
      'sam@example-internal',
      'user:          U.example-staff (Sam)',
      'company:       C.example-internal (Example Internal)',
      'impersonating: no',
    ].join('\n')
  )
  expect(fetchProfile).toHaveBeenCalledOnce()
})

// Guards against reporting the impersonated user as the real one, which happens if the second call
// still sends TERROS_IMPERSONATE.
it('prints the impersonated user and the real user behind it', async () => {
  vi.stubEnv('TERROS_IMPERSONATE', jane.user.userId)
  await expect(whoami()).resolves.toBe(
    [
      'jane@acme-solar',
      'user:          U.example-jane (Jane)',
      'company:       C.example-acme (Acme Solar)',
      'impersonating: yes',
      'real-user:     U.example-staff (Sam)',
      'real-company:  C.example-internal (Example Internal)',
    ].join('\n')
  )
})

// The API ignores an impersonation header that names the signed-in user, so the CLI must not claim it.
it('says it is not impersonating when TERROS_IMPERSONATE names the signed-in user', async () => {
  vi.stubEnv('TERROS_IMPERSONATE', staff.user.userId)
  const output = await whoami()
  expect(output).toContain('impersonating: no')
  expect(output).not.toContain('real-user:')
})
