import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAppUpdate, readDocumentation } from './publish'

const { client } = vi.hoisted(() => ({ client: vi.fn() }))
vi.mock('@terros-inc/sdk', () => ({ TerrosClient: client }))

test.each<{ files: Record<string, string>; documentation: string | undefined }>([
  { files: { 'DOCS.md': '# Docs', 'README.md': '# Readme' }, documentation: '# Docs' },
  { files: { 'README.md': '# Readme' }, documentation: '# Readme' },
  { files: {}, documentation: undefined },
  { files: { 'DOCS.md': ' \n', 'README.md': '' }, documentation: undefined },
])('readDocumentation returns $documentation', async ({ files, documentation }) => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await expect(readDocumentation(dir)).resolves.toBe(documentation)
  rmSync(dir, { recursive: true, force: true })
})

it('includes repository metadata when the manifest declares it', () => {
  const config = {
    appId: 'App.example',
    repository: { url: 'https://example.test/repository', directory: 'integrations/example' },
    scripts: [],
  }

  expect(buildAppUpdate('App.example', config, undefined)).toEqual({
    app: { appId: 'App.example', repository: config.repository },
  })
})

it('does not update app details when the manifest omits repository and documentation is missing', () => {
  expect(buildAppUpdate('App.example', { appId: 'App.example', scripts: [] }, undefined)).toBeUndefined()
})

it('omits repository from a documentation update when the manifest does not declare it', () => {
  expect(buildAppUpdate('App.example', { appId: 'App.example', scripts: [] }, '# Documentation')).toEqual({
    app: { appId: 'App.example', documentation: '# Documentation' },
  })
})

it('makes no API client when validation fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'connect-publish-'))
  const directory = join(root, 'integrations', 'example')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  writeFileSync(
    join(directory, 'terros.json'),
    JSON.stringify({
      appId: 'App.example',
      scripts: [
        {
          name: 'Broken Sync',
          entrypoint: 'src/outgoing.ts',
          type: 'outgoing',
          configSchema: [],
          authSchema: {},
          permissions: ['account/update'],
        },
      ],
    })
  )
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(process, 'cwd').mockReturnValue(directory)
  try {
    const { publishConnectScripts } = await import('./publish')
    await expect(publishConnectScripts()).rejects.toThrow('Connect validation failed')
    expect(client).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  }
})
