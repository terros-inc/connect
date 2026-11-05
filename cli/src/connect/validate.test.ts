import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { validateConnectScripts } from './validate'

const serverSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  oneOf: [
    {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        appVersion: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string', maxLength: 10_000 },
        configSchema: { type: 'array' },
        authSchema: { type: 'object' },
        permissions: { type: 'array', items: { type: 'string', enum: ['account:list'] } },
        type: { type: 'string', enum: ['outgoing'] },
        dataType: { type: 'string', enum: ['Account', 'Company', 'User', 'Event'] },
      },
      required: ['appId', 'appVersion', 'name', 'configSchema', 'authSchema', 'permissions', 'type', 'dataType'],
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe.sequential('Connect script validation', () => {
  it('reports every server payload problem with its script and a useful example', async () => {
    const directory = await integrationDirectory()
    await writeManifest(directory, {
      appId: 'App.example',
      scripts: [
        {
          name: 'Example Sync',
          entrypoint: 'src/outgoing.ts',
          type: 'outgoing',
          configSchema: [],
          authSchema: 'token',
          permissions: ['account/update'],
        },
      ],
    })
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    const error = await validateConnectScripts({ schema: serverSchema }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain(
      'integrations/example/terros.json scripts[0] ("Example Sync").authSchema: expected an object, got string. For example: "authSchema": {}.'
    )
    expect(message).toContain(
      'integrations/example/terros.json scripts[0] ("Example Sync").permissions[0]: expected a valid Terros permission, got string. For example: "permissions": ["account:list"].'
    )
    expect(message).toContain(
      'integrations/example/terros.json scripts[0] ("Example Sync").dataType: expected a string, got missing. For example: "dataType": "Account".'
    )
  })

  it('accepts a plain markdown description', async () => {
    const directory = await integrationDirectory()
    await writeManifest(directory, {
      appId: 'App.example',
      scripts: [
        {
          name: 'Example Sync',
          description: 'Configure the example token.',
          entrypoint: 'src/outgoing.ts',
          type: 'outgoing',
          dataType: 'Account',
          configSchema: [],
          authSchema: {},
          permissions: ['account:list'],
        },
      ],
    })
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    await expect(validateConnectScripts({ schema: serverSchema })).resolves.toMatchObject({
      appId: 'App.example',
    })
  })

  it('uses the CLI schema when the server schema is unavailable', async () => {
    const directory = await integrationDirectory()
    await writeManifest(directory, {
      appId: 'App.example',
      scripts: [
        {
          name: 'Example Sync',
          entrypoint: 'src/outgoing.ts',
          type: 'outgoing',
          dataType: 'Account',
          configSchema: [],
          authSchema: {},
          permissions: ['account:list'],
        },
      ],
    })
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      validateConnectScripts({ fetchSchema: vi.fn().mockRejectedValue(new Error('offline')) })
    ).resolves.toBeDefined()
    expect(warning).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('using the CLI schema'))
  })
})

async function integrationDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'connect-validation-'))
  const directory = join(root, 'integrations', 'example')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  return directory
}

async function writeManifest(directory: string, value: unknown): Promise<void> {
  await writeFile(join(directory, 'terros.json'), JSON.stringify(value))
}
