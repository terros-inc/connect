import { readdirSync, readFileSync } from 'node:fs'
import { ConnectConfig } from './configSchema'

const integrations = new URL('../../../integrations/', import.meta.url)

it.each(readdirSync(integrations))('accepts the %s manifest', (name) => {
  const manifest = JSON.parse(readFileSync(new URL(`${name}/terros.json`, integrations), 'utf-8'))
  expect(ConnectConfig.safeParse(manifest).error).toBeUndefined()
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

it('keeps custom field access on a string config field', () => {
  const manifest = {
    appId: 'App.example',
    scripts: [
      {
        name: 'Sync',
        entrypoint: 'src/sync.ts',
        type: 'scheduled',
        cron: '0 * * * ? *',
        configSchema: [{ name: 'linkField', type: 'string', customFieldAccess: 'write' }],
        authSchema: {},
        permissions: [],
      },
    ],
  }

  expect(ConnectConfig.parse(manifest).scripts[0]?.configSchema).toEqual([
    { name: 'linkField', type: 'string', customFieldAccess: 'write' },
  ])
})

it.each(['number', 'mapping'])('rejects custom field access on a %s config field', (type) => {
  const manifest = {
    appId: 'App.example',
    scripts: [
      {
        name: 'Sync',
        entrypoint: 'src/sync.ts',
        type: 'scheduled',
        cron: '0 * * * ? *',
        configSchema: [{ name: 'linkField', type, customFieldAccess: 'read' }],
        authSchema: {},
        permissions: [],
      },
    ],
  }

  expect(ConnectConfig.safeParse(manifest).success).toBe(false)
})
