export type DeviceCodeResponse = {
  device_code: string
  user_code: string
  expires_in: number
  interval: number
  verification_uri: string
  verification_uri_complete: string
}

export type TokenResponse = {
  access_token: string
  refresh_token: string
  id_token: string | undefined
  token_type: string
  expires_in: number
}

export type SavedTokens = Omit<TokenResponse, 'expires_in'> & {
  expires_at: number
}
