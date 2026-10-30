import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import type { AppId } from '@terros-inc/sdk'
import { toScriptInput } from './publish'
import { ConnectConfig, type TiptapDoc, type UnsavedScript } from './configSchema'

const appId = 'App.example' as AppId

const script = (description?: UnsavedScript['description']): UnsavedScript => ({
  name: 'Example Sync',
  ...(description !== undefined && { description }),
  entrypoint: 'src/index.ts',
  configSchema: [],
  authSchema: {},
  permissions: ['account:list'],
  type: 'scheduled',
  cron: '0 * * * *',
})

const paragraph = (text: string): TiptapDoc['content'][number] => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

describe('toScriptInput', () => {
  it('sends a plain-text description as a doc with one paragraph per blank-line-separated block', () => {
    const input = toScriptInput(
      script('Install once per location.\n\n  \nSet the API key\nas a secret.  \n'),
      appId,
      '1.0.0'
    )

    expect(input.description).toEqual({
      type: 'doc',
      content: [paragraph('Install once per location.'), paragraph('Set the API key\nas a secret.')],
    })
    expect(input).not.toHaveProperty('entrypoint')
  })

  it('sends a doc description unchanged', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'heading' as const, attrs: { level: 2 }, content: [{ type: 'text' as const, text: 'Setup' }] },
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'Bold', marks: [{ type: 'bold' as const }] }],
        },
      ],
    }

    expect(toScriptInput(script(doc), appId, '1.0.0').description).toBe(doc)
  })

  it.each([undefined, '', ' \n\n '])('sends no description for %j', (description) => {
    expect(toScriptInput(script(description), appId, '1.0.0')).not.toHaveProperty('description')
  })
})

describe('integrations/*/terros.json', () => {
  const root = join(import.meta.dirname, '../../../integrations')
  const integrations = readdirSync(root).filter((name) => readdirSync(join(root, name)).includes('terros.json'))

  it.each(integrations)('%s publishes each script description as a doc or not at all', (name) => {
    const config = ConnectConfig.parse(JSON.parse(readFileSync(join(root, name, 'terros.json'), 'utf-8')))

    for (const s of config.scripts) {
      const { description } = toScriptInput(s, appId, '1.0.0')
      if (description !== undefined) expect(description).toMatchObject({ type: 'doc' })
    }
  })
})
