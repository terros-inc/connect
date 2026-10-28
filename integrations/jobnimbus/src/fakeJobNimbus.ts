import { JobNimbusClient, type JobNimbusRecord, type JobNimbusUser } from './jobnimbus.ts'

export type FakeCall = { method: string; path: string; body?: unknown }
type FakeReply = { status: number; headers?: Record<string, string> }

// A small in-memory JobNimbus: jobs and contacts by jnid, lookup by external_id through the documented filter, and
// the account's users. `fail` answers "METHOD /path" with the given replies, in order, before the store does.
export function fakeJobNimbus(
  options: { jobs?: JobNimbusRecord[]; users?: JobNimbusUser[]; fail?: Record<string, FakeReply[]> } = {}
) {
  const calls: FakeCall[] = []
  const slept: number[] = []
  const store = { jobs: new Map<string, JobNimbusRecord>(), contacts: new Map<string, JobNimbusRecord>() }
  for (const job of options.jobs ?? []) store.jobs.set(job.jnid!, job)
  const fail = new Map(Object.entries(options.fail ?? {}).map(([key, replies]) => [key, [...replies]]))
  let nextId = 1

  const reply = (status: number, body?: unknown, headers?: Record<string, string>) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers })

  const fakeFetch = (async (url: string, init: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const path = pathname.replace('/api1', '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })

    const failure = fail.get(`${method} ${path}`)?.shift()
    if (failure) return reply(failure.status, { error: 'fake' }, failure.headers)

    if (method === 'GET' && path === '/account/users') return reply(200, { users: options.users ?? [] })

    const [, collection, jnid] = path.split('/') as [string, 'jobs' | 'contacts', string | undefined]
    const records = store[collection]
    if (!records) return reply(404)

    if (method === 'GET' && !jnid) {
      const filter = JSON.parse(searchParams.get('filter') ?? '{}') as { must?: { term?: Record<string, string> }[] }
      const terms = (filter.must ?? []).map((clause) => clause.term ?? {})
      const results = [...records.values()].filter((record) =>
        terms.every((term) =>
          Object.entries(term).every(([key, value]) => record[key as keyof JobNimbusRecord] === value)
        )
      )
      return reply(200, { count: results.length, results })
    }
    if (method === 'GET') return records.has(jnid!) ? reply(200, records.get(jnid!)) : reply(404)
    if (method === 'POST') {
      // JobNimbus requires a new contact's type and a status from that type's workflow.
      if (collection === 'contacts' && (!body?.record_type_name || !body?.status_name)) return reply(400)
      const record = { ...body, jnid: `jn-${nextId++}` }
      records.set(record.jnid, record)
      return reply(200, record)
    }
    if (method === 'PUT') {
      if (!records.has(jnid!)) return reply(404)
      const record = { ...records.get(jnid!), ...body }
      records.set(jnid!, record)
      return reply(200, record)
    }
    return reply(405)
  }) as typeof fetch

  const client = new JobNimbusClient('key-example', {
    fetch: fakeFetch,
    sleep: async (ms) => {
      slept.push(ms)
    },
  })
  return { client, calls, slept, jobs: store.jobs, contacts: store.contacts }
}

// Records Terros account calls and answers with the given result type.
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
