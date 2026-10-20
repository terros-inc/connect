import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { updateApp } from './update'
import type { AppData } from './types'
import { textToTiptapDoc } from './description'
import { saveConfigAppId } from './configFile'

const storedApp: AppData = {
  appId: 'App.example',
  companyId: 'C.example',
  name: 'Acme CRM',
  status: 'development',
  permissions: ['account:list'],
  documentation: 'Sync accounts with Acme CRM.',
  uploadAvatarUrl: 'https://uploads.example.com/avatar',
}

function fakeClient(): { calls: [string, object][]; call(path: string, input: object): Promise<unknown> } {
  const calls: [string, object][] = []
  return {
    calls,
    async call(path, input) {
      calls.push([path, input])
      if (path === 'connect/app/get') return { type: 'success', app: storedApp, versions: [] }
      return { type: 'success', app: (input as { app: AppData }).app }
    },
  }
}

describe('textToTiptapDoc', () => {
  // The API rejects a plain string, and Tiptap rejects empty text nodes.
  it('splits paragraphs on blank lines and never emits an empty text node', () => {
    expect(textToTiptapDoc('First line\nwraps here.\n\n\nSecond.\n')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line wraps here.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second.' }] },
      ],
    })
    expect(textToTiptapDoc('  ')).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] }] })
  })
})

describe('updateApp', () => {
  // The update schema requires appId, companyId and permissions, and the server stores what it is sent.
  it('sends the stored app with only the requested fields changed', async () => {
    const client = fakeClient()
    await updateApp(client, 'App.example', { status: 'internal' })
    expect(client.calls).toEqual([
      ['connect/app/get', { appId: 'App.example' }],
      ['connect/app/update', { app: { ...storedApp, status: 'internal' } }],
    ])
  })

  it('only reads the app when there is nothing to change, so a logo can still be uploaded', async () => {
    const client = fakeClient()
    const app = await updateApp(client, 'App.example', {})
    expect(client.calls.map(([path]) => path)).toEqual(['connect/app/get'])
    expect(app.uploadAvatarUrl).toBe(storedApp.uploadAvatarUrl)
  })
})

describe('saveConfigAppId', () => {
  async function dirWith(config: object): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'terros-app-'))
    await writeFile(join(dir, 'terros.json'), JSON.stringify(config))
    return dir
  }

  it('adds the app ID after $schema and keeps the scripts', async () => {
    const dir = await dirWith({ $schema: './schema.json', scripts: [{ name: 'Sync' }] })
    expect(await saveConfigAppId(dir, 'App.example')).toBe('saved')
    const saved = JSON.parse(await readFile(join(dir, 'terros.json'), 'utf8'))
    expect(saved).toEqual({ $schema: './schema.json', appId: 'App.example', scripts: [{ name: 'Sync' }] })
    expect(Object.keys(saved)).toEqual(['$schema', 'appId', 'scripts'])
  })

  // Replacing another app's ID would make the next `terros connect publish` deploy to the new, empty app.
  it("never replaces another app's ID", async () => {
    const dir = await dirWith({ appId: 'App.other', scripts: [] })
    expect(await saveConfigAppId(dir, 'App.example')).toEqual({ existingAppId: 'App.other' })
    expect(JSON.parse(await readFile(join(dir, 'terros.json'), 'utf8')).appId).toBe('App.other')
  })

  it('does not create terros.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'terros-app-'))
    expect(await saveConfigAppId(dir, 'App.example')).toBe('missing')
  })
})
