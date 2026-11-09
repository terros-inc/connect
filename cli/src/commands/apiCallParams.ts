import type { ParsedArgs } from 'minimist'
import type { EndpointParameter } from '@terros-inc/mcp-core'
import { INPUT_FILE_FLAG, readInputFile } from '../inputFile'
import { impersonationFlagMessage } from '../impersonation'

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
]

/** Read `terros api call <path> [--body] [--inputFile]` into the one POST it sends. */
export function parseApiCallParams(params: ParsedArgs, args: string[]): { path: string; body: object } {
  const [path, ...extra] = args
  if (path === undefined || extra.length > 0) {
    throw new Error('usage: terros api call <path> [--body <json>] [--inputFile <path>]')
  }
  // The client always prefixes the configured host, so a URL here would silently go to that host instead.
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error(
      `Pass the endpoint path, such as /account/get, not ${path}. Set TERROS_API_ENDPOINT to change the host.`
    )
  }

  const { params: flags, base } = readInputFile(params)
  const unknown = Object.keys(flags).filter((name) => name !== '_' && name !== 'body')
  if (unknown.length > 0) {
    throw new Error(
      impersonationFlagMessage(unknown) ??
        `Unknown parameter(s): ${unknown.map((name) => `--${name}`).join(', ')}. Send request fields in --body or --${INPUT_FILE_FLAG}.`
    )
  }

  const inline = flags.body === undefined ? undefined : parseBody(flags.body)
  return { path, body: { ...base, ...inline } }
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
