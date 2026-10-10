export * from './command.ts'
export * from './endpoint.ts'
export * from './input.ts'
export * from './internal.ts'
export * from './parameters.ts'
export * from './parser.ts'
export * from './schema.ts'
export * from './tools.ts'
export * from './types.ts'

import { parseEndpoints } from './parser.ts'
import type { EndpointGroups } from './endpoint.ts'

export type SpecDocument = string | (() => string | Promise<string>)

export type SpecSource = {
  bundled: SpecDocument
  internal?: () => string | undefined | Promise<string | undefined>
}

async function readSpec(document: SpecDocument): Promise<string> {
  return typeof document === 'function' ? document() : document
}

/** Load endpoint metadata, preferring an injected internal document when available. */
export async function loadEndpoints(source: SpecSource): Promise<EndpointGroups> {
  const internal = await source.internal?.()
  return parseEndpoints(internal ?? (await readSpec(source.bundled)))
}
