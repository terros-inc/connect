import type { Schema } from './types.ts'
import type { Components } from './parameters.ts'

export type EndpointParameter = {
  name: string
  type: string
  required: boolean
  description?: string
}

/** A request body from the document, with its name when the document gives several. */
export type EndpointExample = { name?: string; value: unknown }

export type Endpoint = {
  path: string
  description?: string
  /** Request bodies from the document's examples, used to show sample commands. */
  examples?: EndpointExample[]
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
