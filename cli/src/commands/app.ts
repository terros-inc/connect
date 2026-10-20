import { cwd } from 'node:process'
import type { ParsedArgs } from 'minimist'
import type { EndpointParameter } from '@terros-inc/mcp-core'
import { parseStatus, updateApp } from '../app/update'
import { APP_STATUSES } from '../app/types'
import { checkLogoFile, uploadLogo } from '../app/logo'
import { readTextFlag, rejectUnknownFlags } from '../app/flags'
import { readConfigAppId, saveConfigAppId } from '../app/configFile'
import { addApp } from '../app/add'
import { buildTerrosClient } from '../api/query'

const addParameters: EndpointParameter[] = [
  { name: 'name', type: 'string', required: true, description: 'App name shown to companies that install it' },
  { name: 'description', type: 'string', required: false, description: 'Plain text; blank lines separate paragraphs' },
  { name: 'documentation', type: 'string', required: false, description: 'Markdown documentation' },
]

const updateParameters: EndpointParameter[] = [
  {
    name: 'appId',
    type: 'string',
    required: false,
    description: 'Defaults to the appId in terros.json in this directory',
  },
  { name: 'name', type: 'string', required: false },
  { name: 'description', type: 'string', required: false, description: 'Plain text; blank lines separate paragraphs' },
  {
    name: 'status',
    type: APP_STATUSES.map((status) => `"${status}"`).join(' | '),
    required: false,
    description: 'Publishing needs an approved review and a deployed current version',
  },
  { name: 'logo', type: 'string', required: false, description: 'Path to a .png, .jpg, .gif, .webp or .svg image' },
]

const names = (parameters: EndpointParameter[]): string[] => parameters.map((parameter) => parameter.name)

async function runAdd({ params }: { params: ParsedArgs }): Promise<void> {
  rejectUnknownFlags(params, names(addParameters))
  const name = readTextFlag(params, 'name')
  if (name === undefined || name.trim() === '') throw new Error('Missing required parameter: --name')
  const app = await addApp(buildTerrosClient(), {
    name,
    description: readTextFlag(params, 'description'),
    documentation: readTextFlag(params, 'documentation'),
  })
  console.log(app.appId)
  const saved = await saveConfigAppId(cwd(), app.appId)
  if (saved === 'saved') console.error('Saved the app ID to terros.json')
  else if (saved !== 'missing') console.error(`terros.json already has appId ${saved.existingAppId}; left it unchanged`)
}

async function runUpdate({ params }: { params: ParsedArgs }): Promise<void> {
  rejectUnknownFlags(params, names(updateParameters))
  const appId = readTextFlag(params, 'appId') ?? (await readConfigAppId(cwd()))
  if (appId === undefined) throw new Error('Missing --appId, and no appId in terros.json in this directory')
  const status = readTextFlag(params, 'status')
  const logo = readTextFlag(params, 'logo')
  if (logo !== undefined) await checkLogoFile(logo)
  const changes = {
    name: readTextFlag(params, 'name'),
    description: readTextFlag(params, 'description'),
    status: status === undefined ? undefined : parseStatus(status),
  }
  if (Object.values(changes).every((value) => value === undefined) && logo === undefined) {
    throw new Error('Nothing to update: pass --name, --description, --status or --logo')
  }

  const app = await updateApp(buildTerrosClient(), appId, changes)
  if (logo !== undefined) {
    await uploadLogo(app.uploadAvatarUrl, logo)
    console.error('Uploaded the logo; it can take a few seconds to appear')
  }
  const { uploadAvatarUrl: _uploadAvatarUrl, ...printed } = app
  console.log(JSON.stringify(printed, null, 2))
}

export const appCommands = {
  add: {
    description:
      'Create a Connect app in your current company, in development status, and print its app ID. Requires app:manage. ' +
      'If terros.json in this directory has no appId, the new ID is saved there.',
    parameters: addParameters,
    run: runAdd,
  },
  update: {
    description: 'Change a Connect app and print it, optionally uploading its logo. Requires app:manage.',
    parameters: updateParameters,
    run: runUpdate,
  },
}
