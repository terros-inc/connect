export type DeviceCodeResponse = {
  device_code: string
  user_code: string
  expires_in: number
  interval: number
  verification_uri: string
  verification_uri_complete: string
}
