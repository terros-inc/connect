import type { ParsedArgs } from 'minimist'
import type { EndpointParameter } from '@terros-inc/mcp-core'
import { INPUT_FILE_FLAG, readInputFile } from '../inputFile'

export type ApiCallRequest = { method: 'GET'; path: string } | { method: 'POST'; path: string; body: object }

export const apiCallParameters: EndpointParameter[] = [
  {
    name: 'body',
    type: 'string',
    required: false,
    description: `The JSON request body, an object such as '{"accountId":"A.example"}'; its fields override --${INPUT_FILE_FLAG}'s`,
  },
  {
    name: INPUT_FILE_FLAG,
    type: 'string',
    required: false,
    description: 'A file holding the JSON request body, or - for stdin',
  },
  { name: 'method', type: 'string', required: false, description: 'POST (the default) or GET, which sends no body' },
]

const API_CALL_FLAGS = new Set(['body', 'method'])

/** Read `terros api call <path> [--method] [--body] [--inputFile]` into the one request it sends. */
export function parseApiCallParams(params: ParsedArgs, args: string[]): ApiCallRequest {
  const [path, ...extra] = args
  if (path === undefined || extra.length > 0) {
    throw new Error('usage: terros api call <path> [--method GET|POST] [--body <json>] [--inputFile <path>]')
  }
  // The client always prefixes the configured host, so a URL here would silently go to that host instead.
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error(
      `Pass the endpoint path, such as /account/get, not ${path}. Set TERROS_API_ENDPOINT to change the host.`
    )
  }

  const { params: flags, base } = readInputFile(params)
  const unknown = Object.keys(flags).filter((name) => name !== '_' && !API_CALL_FLAGS.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown parameter(s): ${unknown.map((name) => `--${name}`).join(', ')}. Send request fields in --body or --${INPUT_FILE_FLAG}.`
    )
  }

  const method = flags.method === undefined ? 'POST' : String(flags.method).toUpperCase()
  if (method !== 'GET' && method !== 'POST') throw new Error('--method must be GET or POST')
  const inline = flags.body === undefined ? undefined : parseBody(flags.body)
  if (method === 'GET') {
    if (inline !== undefined || base !== undefined) throw new Error('A GET request sends no body')
    return { method, path }
  }
  return { method, path, body: { ...base, ...inline } }
}

function parseBody(value: unknown): Record<string, unknown> {
  let body: unknown
  try {
    body = typeof value === 'string' ? JSON.parse(value) : undefined
  } catch {
    // Reported below with the expected shape.
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`--body expects a JSON object, such as '{"accountId":"A.example"}'`)
  }
  return body as Record<string, unknown>
}
