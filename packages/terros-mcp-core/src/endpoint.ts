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
  description?: string
  properties: Schema
  components: Components
}

export type Endpoints = {
  [alias: string]: Endpoint
}

/**
 * Endpoints keyed by their first path segment (the top-level CLI command), then by the remaining segments joined
 * with spaces (`/garden/bed/list` → `garden` → `bed list`). A single-segment path such as `/search` uses `''`.
 */
export type EndpointGroups = {
  [group: string]: Endpoints
}
