import type { RemoteMcpHandler } from './handler.ts'

/** The subset of an API Gateway REST API (payload format 1.0) proxy event the server reads. */
export type ProxyEvent = {
  httpMethod: string
  path: string
  headers?: Record<string, string | undefined> | null
  multiValueQueryStringParameters?: Record<string, string[] | undefined> | null
  body?: string | null
  isBase64Encoded?: boolean
  requestContext?: { requestId?: string }
}

export type ProxyResult = {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded: false
}

export function toRequest(event: ProxyEvent): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value)
  }
  const url = new URL(event.path, `https://${headers.get('host') ?? 'invalid.host'}`)
  for (const [name, values] of Object.entries(event.multiValueQueryStringParameters ?? {})) {
    for (const value of values ?? []) url.searchParams.append(name, value)
  }
  const hasBody = event.body != null && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD'
  return new Request(url, {
    method: event.httpMethod,
    headers,
    body: hasBody ? (event.isBase64Encoded ? Buffer.from(event.body!, 'base64') : event.body) : undefined,
  })
}

export async function toProxyResult(response: Response): Promise<ProxyResult> {
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
    isBase64Encoded: false,
  }
}

export function createLambdaHandler(serve: RemoteMcpHandler): (event: ProxyEvent) => Promise<ProxyResult> {
  return async (event) => {
    const started = Date.now()
    const result = await toProxyResult(await serve(toRequest(event)))
    // One structured line per request; never log headers or bodies, which carry tokens and customer data.
    console.log(
      JSON.stringify({
        requestId: event.requestContext?.requestId,
        method: event.httpMethod,
        path: event.path,
        status: result.statusCode,
        durationMs: Date.now() - started,
      })
    )
    return result
  }
}
