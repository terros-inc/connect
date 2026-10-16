import type { Schema } from './types.ts'
import type { Components } from './parameters.ts'

export type EndpointParameter = {
  name: string
  type: string
  required: boolean
  description?: string
}

export type Endpoint = {
  path: string
  summary?: string
  description?: string
  tags?: string[]
  /** `x-terros-readOnly` from the OpenAPI operation, when set. */
  readOnly?: boolean
  /** `x-terros-destructive` from the OpenAPI operation, when set. */
  destructive?: boolean
  properties: Schema
  components: Components
}

export type Endpoints = {
  [alias: string]: Endpoint
}

export type EndpointGroups = {
  [alias: string]: Endpoints
}
