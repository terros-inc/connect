import type { SmallUser } from '@terros-inc/sdk'
import { AccuLynxClient } from './acculynx.ts'
import { type Clock, RateLimiter } from './rateLimit.ts'

export type FakeCall = { method: string; path: string; query: string; body?: unknown }
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

// AccuLynx client against canned replies keyed by "METHOD /path", or "METHOD /path?query" to answer one query only.
// A key with several replies answers them in order.
export function fakeAccuLynx(replies: Record<string, FakeReply | FakeReply[]>, diagnostics = false) {
  const calls: FakeCall[] = []
  const queues = new Map(
    Object.entries(replies).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]])
  )

  const fakeFetch = (async (url: string, init: RequestInit) => {
    const { pathname, search } = new URL(url)
    const path = pathname.replace('/api/v2', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, query: search, body: init.body ? JSON.parse(String(init.body)) : undefined })

    const queue = queues.get(`${method} ${path}${search}`) ?? queues.get(`${method} ${path}`)
    const reply = (queue && queue.length > 1 ? queue.shift() : queue?.[0]) ?? { status: 404 }
    const status = reply.status ?? 200
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status,
      headers: reply.headers,
    })
  }) as typeof fetch

  const clock = fakeClock()
  const client = new AccuLynxClient('key-example', {
    fetch: fakeFetch,
    clock,
    limiter: new RateLimiter(10, clock),
    diagnostics,
  })
  return { client, calls, clock, fetch: fakeFetch }
}

export function contactTypes(...items: { id: string; name: string; isDefault: boolean }[]): FakeReply {
  return { body: { items } }
}

// Records Terros account calls and answers success.
export function fakeTerros(
  type: 'success' | 'error' = 'success',
  usersOrCustomFields: SmallUser[] | Record<string, unknown> = [],
  initialAccount: Record<string, unknown> = {}
) {
  const updates: unknown[] = []
  const upserts: unknown[] = []
  const users = Array.isArray(usersOrCustomFields) ? usersOrCustomFields : []
  const initialCustomFields = Array.isArray(usersOrCustomFields) ? {} : usersOrCustomFields
  const customFields = { ...initialCustomFields }
  const account = {
    get: async () => ({ account: { ...initialAccount, customFields } }),
    update: async (input: unknown) => {
      updates.push(input)
      const patch = (input as { account?: { customFieldsPatch?: Record<string, unknown> } }).account?.customFieldsPatch
      if (patch) Object.assign(customFields, patch)
      return { type }
    },
    upsert: async (input: { account: { accountId?: string } }) => {
      upserts.push(input)
      return { type, account: { accountId: input.account.accountId ?? 'Account.example' } }
    },
  }
  const user = { list: async () => ({ type: 'success', users }) }
  return { terros: { account, user } as never, updates, upserts }
}
