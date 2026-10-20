import type { TiptapDoc } from './description'

export type ApiCaller = { call(path: string, input: object): Promise<unknown> }

export const APP_STATUSES = ['development', 'internal', 'published', 'deprecated'] as const
export type AppStatus = (typeof APP_STATUSES)[number]

/** The fields of a Connect app the CLI reads or changes; the rest pass through unchanged. */
export type AppData = {
  appId: string
  companyId: string
  permissions: string[]
  name: string
  description?: TiptapDoc
  status?: AppStatus
  uploadAvatarUrl?: string
  [field: string]: unknown
}

export type AppResponse = { type: 'success'; app: AppData }

export function assertAppResponse(value: unknown): AppResponse {
  if (!value || typeof value !== 'object' || !('app' in value)) throw new Error('Invalid Connect app response')
  const { app } = value as { app: unknown }
  if (!app || typeof app !== 'object' || typeof (app as AppData).appId !== 'string') {
    throw new Error('Invalid Connect app response')
  }
  return value as AppResponse
}
