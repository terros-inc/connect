import { type ApiCaller, type AppData, type AppStatus, APP_STATUSES, assertAppResponse } from './types'
import { textToTiptapDoc } from './description'

export type AppChanges = {
  name?: string
  description?: string
  status?: AppStatus
}

export function parseStatus(status: string): AppStatus {
  if (!(APP_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`--status must be one of: ${APP_STATUSES.join(', ')}`)
  }
  return status as AppStatus
}

function hasChanges(changes: AppChanges): boolean {
  return Object.values(changes).some((value) => value !== undefined)
}

/**
 * The update to send: the fields the schema requires, taken from the stored app, plus the requested changes. The API
 * merges it onto the stored app, so every other field keeps its stored value even if it changed since the get.
 */
export function buildAppUpdate(app: AppData, changes: AppChanges): AppData {
  const { appId, companyId, permissions, name } = app
  return {
    appId,
    companyId,
    permissions,
    name: changes.name ?? name,
    ...(changes.description === undefined ? {} : { description: textToTiptapDoc(changes.description) }),
    ...(changes.status === undefined ? {} : { status: changes.status }),
  }
}

/**
 * Fetch the app, then send the update. The API enforces its own rules (publishing needs an approved
 * review and a deployed current version) and its errors are thrown as they are. With no changes, nothing is sent and
 * the fetched app is returned, whose `uploadAvatarUrl` still accepts a logo.
 */
export async function updateApp(client: ApiCaller, appId: string, changes: AppChanges): Promise<AppData> {
  const { app } = assertAppResponse(await client.call('connect/app/get', { appId }))
  if (!hasChanges(changes)) return app
  return assertAppResponse(await client.call('connect/app/update', { app: buildAppUpdate(app, changes) })).app
}
