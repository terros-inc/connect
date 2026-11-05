import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readDocumentation } from './publish'

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
