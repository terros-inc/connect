import { type ApiCaller, type AppData, assertAppResponse } from './types'
import { textToTiptapDoc } from './description'

export type AddAppOptions = {
  name: string
  description?: string
  documentation?: string
}

/** Create a Connect app in the caller's current company. The API always starts it in `development`. */
export async function addApp(client: ApiCaller, options: AddAppOptions): Promise<AppData> {
  const { name, description, documentation } = options
  const app = {
    name,
    ...(description === undefined ? {} : { description: textToTiptapDoc(description) }),
    ...(documentation === undefined ? {} : { documentation }),
  }
  return assertAppResponse(await client.call('connect/app/add', { app })).app
}
