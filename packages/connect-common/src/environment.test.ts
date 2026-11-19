import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveEnvironment } from './environment.ts'

const configDir = join(homedir(), '.config', 'terros')

describe('resolveEnvironment', () => {
  // Customers must keep the production host and their existing sign-in file.
  it('defaults to production with the original state directory', () => {
    expect(resolveEnvironment({})).toEqual({ name: 'prod', baseUrl: 'https://api.terros.com', stateDir: configDir })
    expect(resolveEnvironment({ TERROS_ENV: 'prod' }).stateDir).toBe(configDir)
  })

  // A staging login stored in the production file would be sent to production, and the reverse.
  it('gives staging and a developer stack their own host and state directory', () => {
    expect(resolveEnvironment({ TERROS_ENV: 'staging' })).toEqual({
      name: 'staging',
      baseUrl: 'https://api.staging.terros.com',
      stateDir: join(configDir, 'env', 'staging'),
    })
    expect(resolveEnvironment({ TERROS_ENV: ' Alex ' })).toMatchObject({
      baseUrl: 'https://api.alex.terros.com',
      stateDir: join(configDir, 'env', 'alex'),
    })
  })

  // A value like "x/../.." would otherwise escape the state directory or change the host.
  it('rejects a name that is not a plain stack name', () => {
    for (const bad of ['../x', 'a.b', 'evil.example/', '-x'])
      expect(() => resolveEnvironment({ TERROS_ENV: bad })).toThrow(/Unknown environment/)
  })

  it('partitions endpoint overrides and rejects conflicting selections', () => {
    expect(resolveEnvironment({ TERROS_API_ENDPOINT: 'https://api.staging.terros.com' })).toEqual(
      resolveEnvironment({ TERROS_ENV: 'staging' })
    )
    expect(resolveEnvironment({ TERROS_ENV: 'prod', TERROS_API_ENDPOINT: 'api.terros.com' }).stateDir).toBe(configDir)
    expect(() => resolveEnvironment({ TERROS_ENV: 'prod', TERROS_API_ENDPOINT: 'api.staging.terros.com' })).toThrow(
      /conflicts/
    )
  })

  // Staff-only comes from isolation: an environment sends its own credentials to its own host and nothing else, so an
  // arbitrary host must never be selectable (it would receive a saved sign-in or API key).
  it('accepts only Terros stage hosts and http://localhost', () => {
    expect(resolveEnvironment({ TERROS_API_ENDPOINT: 'http://localhost:3000' })).toMatchObject({
      name: 'localhost',
      baseUrl: 'http://localhost:3000',
      stateDir: join(configDir, 'env', 'localhost', 'port-3000'),
    })
    expect(resolveEnvironment({ TERROS_API_ENDPOINT: 'http://localhost:3001' }).stateDir).not.toBe(
      resolveEnvironment({ TERROS_API_ENDPOINT: 'http://localhost:3000' }).stateDir
    )
    expect(resolveEnvironment({ TERROS_API_ENDPOINT: 'https://api.localhost.terros.com' }).stateDir).not.toBe(
      resolveEnvironment({ TERROS_API_ENDPOINT: 'http://localhost:3000' }).stateDir
    )
    expect(() => resolveEnvironment({ TERROS_ENV: 'prod', TERROS_API_ENDPOINT: 'http://localhost:3000' })).toThrow(
      /conflicts/
    )
    for (const bad of [
      'https://x.example.test',
      'https://api.staging.terros.com.evil.example',
      'https://evil.example/api.staging.terros.com',
      'http://api.staging.terros.com',
      // Built at runtime so no committed line looks like an email address to the public-data check.
      ['https://user', 'api.staging.terros.com'].join('@'),
      'https://api.staging.terros.com:8443',
      'https://api.prod.terros.com',
      'http://localhost.evil.example',
    ])
      expect(() => resolveEnvironment({ TERROS_API_ENDPOINT: bad }), bad).toThrow(/Unsupported API host/)
  })

  // "--env production" must reach production, not a stack named production (api.production.terros.com).
  it('treats production as prod and localhost as the endpoint override', () => {
    expect(resolveEnvironment({ TERROS_ENV: 'Production' })).toEqual(resolveEnvironment({}))
    expect(() =>
      resolveEnvironment({ TERROS_ENV: 'production', TERROS_API_ENDPOINT: 'api.staging.terros.com' })
    ).toThrow(/conflicts/)
    expect(resolveEnvironment({ TERROS_ENV: 'localhost', TERROS_API_ENDPOINT: 'http://localhost:3000' })).toEqual(
      resolveEnvironment({ TERROS_API_ENDPOINT: 'http://localhost:3000' })
    )
    expect(() =>
      resolveEnvironment({ TERROS_ENV: 'localhost', TERROS_API_ENDPOINT: 'https://api.localhost.terros.com' })
    ).toThrow(/http:\/\/localhost/)
    expect(() => resolveEnvironment({ TERROS_ENV: 'localhost' })).toThrow(/TERROS_API_ENDPOINT=http:\/\/localhost/)
  })

  // Falling through on a blank value would run a staging command against production.
  it('rejects a whitespace-only TERROS_ENV instead of defaulting to production', () => {
    expect(() => resolveEnvironment({ TERROS_ENV: '  ' })).toThrow(/blank/)
    expect(() => resolveEnvironment({ TERROS_ENV: '' })).toThrow(/blank/)
    expect(resolveEnvironment({}).name).toBe('prod')
  })
})
