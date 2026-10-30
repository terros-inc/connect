import { cwd } from 'node:process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { publishConnectScripts } from './publish'

vi.mock('node:process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:process')>()),
  cwd: vi.fn(),
}))
vi.mock('./package', () => ({
  packageScripts: vi.fn(async () => ({ scripts: [], config: { appId: 'App.example', scripts: [] } })),
}))

const client = vi.hoisted(() => ({
  connect: {
    app: { update: vi.fn() },
    version: {
      get: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
    },
  },
}))
vi.mock('@terros-inc/sdk', () => ({
  TerrosClient: class {
    connect = client.connect
  },
}))

let dir: string

beforeEach(() => {
  // Skip publish's fixed wait before marking the version deployed.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((resolve: () => void) => resolve()) as typeof setTimeout)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  dir = mkdtempSync(join(tmpdir(), 'publish-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  vi.mocked(cwd).mockReturnValue(dir)
  client.connect.version.get.mockRejectedValue(new Error('NotFound'))
  client.connect.version.add.mockResolvedValue({
    appVersion: { appId: 'App.example', appVersion: '1.0.0', status: 'draft', versionId: 'AppVersion.example' },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

async function publish(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await publishConnectScripts()
}

test.each<{ files: Record<string, string>; documentation: string }>([
  { files: { 'README.md': '# Readme' }, documentation: '# Readme' },
  { files: { 'README.md': '# Readme', 'DOCS.md': '# Docs' }, documentation: '# Docs' },
])('publish sends $documentation as the app documentation', async ({ files, documentation }) => {
  await publish(files)

  expect(client.connect.app.update).toHaveBeenCalledWith({ app: { appId: 'App.example', documentation } })
  expect(client.connect.version.update).toHaveBeenCalled()
})

test('publish leaves the app documentation unchanged when there is no docs file', async () => {
  await publish({})

  expect(client.connect.app.update).not.toHaveBeenCalled()
  expect(client.connect.version.update).toHaveBeenCalled()
})
