import type { Schema } from './types'

export type EndpointParameter = {
  name: string
  type: string
  required: boolean
  description?: string
}

export type Endpoint = {
  path: string
  properties: Schema
  parameters: EndpointParameter[]
}

export type Endpoints = {
  [alias: string]: Endpoint
}

export type EndpointGroups = {
  [alias: string]: Endpoints
}
