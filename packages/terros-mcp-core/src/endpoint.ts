import type { Schema } from './types.ts'
import type { Components } from './parameters.ts'

export type EndpointParameter = {
  name: string
  type: string
  required: boolean
  description?: string
  /** The shortest list the API accepts, refused before sending: for some lists, such as a key's permissions, empty means "all". */
  minItems?: number
}

export type Endpoint = {
  path: string
  description?: string
  /** A request body from the document's examples, used to show a sample command. */
  example?: unknown
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
