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

/** The stored app with only the requested fields changed, so `appId`, `companyId` and `permissions` come along. */
export function mergeAppChanges(app: AppData, changes: AppChanges): AppData {
  const { name, description, status } = changes
  return {
    ...app,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description: textToTiptapDoc(description) }),
    ...(status === undefined ? {} : { status }),
  }
}

/**
 * Fetch the app, then send it back with the changes. The API enforces its own rules (publishing needs an approved
 * review and a deployed current version) and its errors are thrown as they are. With no changes, nothing is sent and
 * the fetched app is returned, whose `uploadAvatarUrl` still accepts a logo.
 */
export async function updateApp(client: ApiCaller, appId: string, changes: AppChanges): Promise<AppData> {
  const { app } = assertAppResponse(await client.call('connect/app/get', { appId }))
  if (!hasChanges(changes)) return app
  return assertAppResponse(await client.call('connect/app/update', { app: mergeAppChanges(app, changes) })).app
}
