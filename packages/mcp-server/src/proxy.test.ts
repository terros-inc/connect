import { createLambdaHandler, toRequest, type ProxyEvent } from './proxy.ts'

const event: ProxyEvent = {
  httpMethod: 'POST',
  path: '/',
  headers: { Host: 'mcp.example.test', 'Content-Type': 'application/json' },
  multiValueQueryStringParameters: { a: ['1', '2'] },
  body: Buffer.from('{"jsonrpc":"2.0"}').toString('base64'),
  isBase64Encoded: true,
  requestContext: { requestId: 'req-1' },
}

it('builds a request on the Host the gateway received', async () => {
  const request = toRequest(event)
  expect(request.url).toBe('https://mcp.example.test/?a=1&a=2')
  expect(request.headers.get('host')).toBe('mcp.example.test')
  expect(await request.text()).toBe('{"jsonrpc":"2.0"}')
})

it('drops the body of a GET', async () => {
  const request = toRequest({ ...event, httpMethod: 'GET', body: 'ignored', isBase64Encoded: false })
  expect(request.body).toBeNull()
})

it('returns the response and logs one line without headers or body', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const handler = createLambdaHandler(async () => Response.json({ ok: true }, { status: 201 }))
  const result = await handler({ ...event, headers: { ...event.headers, authorization: 'Bearer secret-token' } })
  expect(result).toMatchObject({ statusCode: 201, body: '{"ok":true}', isBase64Encoded: false })
  expect(result.headers['content-type']).toBe('application/json')
  expect(log).toHaveBeenCalledOnce()
  const line = String(log.mock.calls[0]![0])
  expect(JSON.parse(line)).toMatchObject({ requestId: 'req-1', method: 'POST', path: '/', status: 201 })
  expect(line).not.toContain('secret-token')
  log.mockRestore()
})
