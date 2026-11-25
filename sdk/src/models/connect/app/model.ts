export type AppId = `App.${string}`

export type AppRepository = {
  url: string
  directory?: string
}

export type AppData = {
  appId: AppId
  repository?: AppRepository
}
