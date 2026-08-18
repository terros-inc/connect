import type { Schema } from './types'
import type { Components } from './parameters'

export type EndpointParameter = {
  name: string
  type: string
  required: boolean
  description?: string
}

export type Endpoint = {
  path: string
  description?: string
  properties: Schema
  components: Components
  parameters: EndpointParameter[]
}

export type Endpoints = {
  [alias: string]: Endpoint
}

export type EndpointGroups = {
  [alias: string]: Endpoints
}
