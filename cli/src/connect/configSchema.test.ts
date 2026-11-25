import { readdirSync, readFileSync } from 'node:fs'
import { ConfigSchemaField, ConnectConfig } from './configSchema'

const integrations = new URL('../../../integrations/', import.meta.url)

it.each(readdirSync(integrations))('accepts the %s manifest', (name) => {
  const manifest = JSON.parse(readFileSync(new URL(`${name}/terros.json`, integrations), 'utf-8'))
  expect(ConnectConfig.safeParse(manifest).error).toBeUndefined()
})

it.each(['http://example.test/repo', 'git://example.test/repo', 'git@example.test:repo.git'])(
  'rejects the non-https repository URL %s',
  (url) => {
    const manifest = { appId: 'App.example', repository: { url }, scripts: [] }
    expect(ConnectConfig.safeParse(manifest).success).toBe(false)
  }
)

it('keeps repository optional', () => {
  expect(ConnectConfig.safeParse({ appId: 'App.example', scripts: [] }).success).toBe(true)
})

it.each(['account/update', 'account.save', 'account', 'Account:save'])('rejects the permission %s', (permission) => {
  const script = { name: 'Send', entrypoint: 'src/outgoing.ts', type: 'outgoing', dataType: 'Account' }
  const manifest = {
    appId: 'App.example',
    scripts: [{ ...script, configSchema: [], authSchema: {}, permissions: [permission] }],
  }
  expect(ConnectConfig.safeParse(manifest).success).toBe(false)
})

it('accepts a three-part permission', () => {
  const script = { name: 'Sync', entrypoint: 'src/sync.ts', type: 'scheduled', cron: '0 * * * ? *' }
  const manifest = {
    appId: 'App.example',
    scripts: [{ ...script, configSchema: [], authSchema: {}, permissions: ['event:outcome:save'] }],
  }
  expect(ConnectConfig.safeParse(manifest).success).toBe(true)
})

it('accepts boolean, select, and entity picker config fields', () => {
  const script = { name: 'Sync', entrypoint: 'src/sync.ts', type: 'scheduled', cron: '0 * * * ? *' }
  const manifest = {
    appId: 'App.example',
    scripts: [
      {
        ...script,
        configSchema: [
          { name: 'Enabled', type: 'boolean' },
          { name: 'Region', type: 'select', options: ['North', 'South'] },
          { name: 'Team', type: 'team' },
          { name: 'Stage', type: 'workflow-stage' },
          { name: 'Owner', type: 'user' },
        ],
        authSchema: {},
        permissions: [],
      },
    ],
  }

  expect(ConnectConfig.safeParse(manifest).success).toBe(true)
})

it.each([
  { name: 'missing options', field: { name: 'Region', type: 'select' } },
  { name: 'empty options', field: { name: 'Region', type: 'select', options: [] } },
])('rejects a select field with $name', ({ field }) => {
  const script = { name: 'Sync', entrypoint: 'src/sync.ts', type: 'scheduled', cron: '0 * * * ? *' }
  const manifest = {
    appId: 'App.example',
    scripts: [{ ...script, configSchema: [field], authSchema: {}, permissions: [] }],
  }

  expect(ConnectConfig.safeParse(manifest).success).toBe(false)
})

it.each(['', '   ', '\t\n'])('rejects the blank select option %j', (option) => {
  const result = parseConfigField({ name: 'Region', type: 'select', options: ['North', option] })

  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({ message: 'Select options cannot be blank or whitespace-only' })
  )
})

it('rejects duplicate select options', () => {
  const result = parseConfigField({ name: 'Region', type: 'select', options: ['North', 'South', 'North'] })

  expect(result.error?.issues).toContainEqual(expect.objectContaining({ message: 'Select options must be unique' }))
})

it('preserves exact, case-sensitive select option values', () => {
  const options = ['North', 'north', ' North ']
  const result = ConfigSchemaField.parse({ name: 'Region', type: 'select', options })

  expect(result.type === 'select' && result.options).toEqual(options)
})

function parseConfigField(field: object): ReturnType<typeof ConnectConfig.safeParse> {
  const script = { name: 'Sync', entrypoint: 'src/sync.ts', type: 'scheduled', cron: '0 * * * ? *' }
  return ConnectConfig.safeParse({
    appId: 'App.example',
    scripts: [{ ...script, configSchema: [field], authSchema: {}, permissions: [] }],
  })
}
