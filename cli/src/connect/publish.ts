import { cwd } from 'node:process'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { type AppId, TerrosClient } from '@terros-inc/sdk'
import { packageScripts, type ScriptZip } from './package'

export async function publishConnectScripts(): Promise<void> {
  const { scripts, config } = await packageScripts()
  const packageJson = join(cwd(), 'package.json')
  const { version } = JSON.parse(readFileSync(packageJson, { encoding: 'utf-8' })) as { version: string }
  const client = new TerrosClient()
  const appId = config.appId as AppId
  const { appVersion } = await client.connect.version.add({
    versionData: {
      appId,
      appVersion: version,
      status: 'draft',
    },
  })
  console.log('Created new app version')
  await Promise.all(scripts.map((s) => uploadScript(client, appId, version, s)))
  await new Promise((resolve) => setTimeout(resolve, 5000))
  await client.connect.version.update({
    appVersion: {
      ...appVersion,
      status: 'deployed',
    },
  })
  console.log(`Published new version ${version}`)
}

async function uploadScript(
  client: TerrosClient,
  appId: AppId,
  appVersion: string,
  { script, zip }: ScriptZip
): Promise<void> {
  const { size: scriptSize } = await stat(zip)
  const data = await readFile(zip)
  const { entrypoint, ...rest } = script

  const res = await client.connect.script.add({
    script: {
      ...rest,
      appId,
      appVersion,
      scriptStorage: 'blob',
    },
    scriptSize,
  })

  if (!res.uploadUrl) throw new Error('Failed to create app script')

  const uploadRes = await fetch(res.uploadUrl, {
    method: 'PUT',
    body: data,
    headers: {
      'Content-Type': 'application/zip',
      'If-None-Match': '*'
    },
  })

  if (!uploadRes.ok) throw new Error(`Failed to upload app script, ${await uploadRes.text()}`)
  console.log(`Uploaded '${script.name}' script`)
}
