import { type Clock, RateLimiter } from './rateLimit.ts'
import { AccuLynxClient } from './acculynx.ts'

export type FakeCall = { method: string; path: string; body?: unknown }
type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> }

// A clock whose sleep moves time forward at once, so rate-limit waits are instant and measurable.
export function fakeClock(start = 0): Clock & { slept: number[] } {
  let time = start
  const slept: number[] = []
  return {
    slept,
    now: () => time,
    sleep: async (ms) => {
      slept.push(ms)
      time += ms
    },
  }
}

// AccuLynx client against canned replies keyed by "METHOD /path". A key with several replies answers them in order.
export function fakeAccuLynx(replies: Record<string, FakeReply | FakeReply[]>) {
  const calls: FakeCall[] = []
  const queues = new Map(
    Object.entries(replies).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]])
  )

  const fakeFetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/api/v2', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })

    const queue = queues.get(`${method} ${path}`)
    const reply = (queue && queue.length > 1 ? queue.shift() : queue?.[0]) ?? { status: 404 }
    const status = reply.status ?? 200
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status,
      headers: reply.headers,
    })
  }) as typeof fetch

  const clock = fakeClock()
  const client = new AccuLynxClient('key-example', { fetch: fakeFetch, clock, limiter: new RateLimiter(10, clock) })
  return { client, calls, clock }
}

// Records Terros account calls and answers success.
export function fakeTerros(type: 'success' | 'error' = 'success') {
  const updates: unknown[] = []
  const upserts: unknown[] = []
  const account = {
    update: async (input: unknown) => {
      updates.push(input)
      return { type }
    },
    upsert: async (input: { account: { accountId?: string } }) => {
      upserts.push(input)
      return { type, account: { accountId: input.account.accountId ?? 'Account.example' } }
    },
  }
  return { terros: { account } as never, updates, upserts }
}
