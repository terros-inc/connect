import type { AccountData, AccountId } from '@terros-inc/sdk'
import { LeadPerfectionClient, type LeadPerfectionSecrets } from './leadperfection.ts'

export type FakeCall = { url: string; form: Record<string, string>; contentType?: string; authorization?: string }
// A reply, or an error fetch throws the way a dropped connection or a timeout does.
type FakeReply = { status: number; body: unknown } | { throws: Error }

let installs = 0

// Distinct credentials per call, so each test is its own install in the process-wide token cache.
export function fakeSecrets(overrides: Partial<LeadPerfectionSecrets> = {}): LeadPerfectionSecrets {
  installs++
  return {
    server: 'apitest',
    clientId: 'acme1',
    appKey: 'appkey-example',
    username: `user-example-${installs}`,
    password: 'password-example',
    ...overrides,
  }
}

// A small LeadPerfection: password-grant tokens that expire, form-encoded POSTs, LeadAdd into an inbound queue,
// GetJobStatusChanges paged by page number, GetSalesApptDetailDateRange and GetLead. Replies follow what the
// sandbox returned, including its 401 messages. `fail` answers a path with the given replies, in order, first.
export function fakeLeadPerfection(
  options: {
    secrets?: LeadPerfectionSecrets
    // Credentials LeadPerfection accepts, where they differ from the ones the client sends.
    accepts?: Partial<LeadPerfectionSecrets>
    // Oldest status change first.
    jobs?: object[]
    appointments?: object[]
    leads?: Record<string, object[]>
    expiresIn?: number
    fail?: Record<string, FakeReply[]>
  } = {}
) {
  const secrets = options.secrets ?? fakeSecrets()
  const accepted = { ...secrets, ...options.accepts }
  const calls: FakeCall[] = []
  const issued = new Set<string>()
  const added: Record<string, string>[] = []
  const fail = new Map(Object.entries(options.fail ?? {}).map(([path, replies]) => [path, [...replies]]))
  const clock = { time: Date.parse('2026-11-18T15:00:00Z'), now: () => clock.time }

  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

  const fakeFetch = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? '')))
    calls.push({ url, form, contentType: headers['Content-Type'], authorization: headers.Authorization })
    const path = new URL(url).pathname

    const failure = fail.get(path)?.shift()
    if (failure && 'throws' in failure) throw failure.throws
    if (failure) return reply(failure.status, failure.body)

    if (path === '/token') {
      if (form.clientid !== accepted.clientId) return reply(401, { Message: 'Invalid ClientID' })
      if (
        form.username !== accepted.username ||
        form.password !== accepted.password ||
        form.appkey !== accepted.appKey
      ) {
        return reply(401, { Message: 'INVALID USER NAME/PASSWORD' })
      }
      const token = `token-${issued.size + 1}`
      issued.add(token)
      return reply(200, {
        user_data: { Emp_ID: 600, Settings: ['SalesmanCanUpdate'] },
        access_token: token,
        token_type: 'bearer',
        expires_in: options.expiresIn ?? 86_400,
        refresh_token: `refresh-${token}`,
      })
    }

    if (!issued.has(headers.Authorization?.replace('Bearer ', '') ?? '')) {
      return reply(401, { Message: 'Invalid Token, Please Regenerate Token and Try Again!' })
    }

    switch (path) {
      case '/api/Leads/LeadAdd':
        added.push(form)
        return reply(200, [{ id: 2900 + added.length, Status: 1, Message: 'Success' }])
      case '/api/Customers/GetJobStatusChanges': {
        const size = Number(form.PageSize)
        const page = Number(form.StartIndex)
        // sortorder 4 is status date descending; like the sandbox, a page's rows come back in job ID order.
        const jobs = form.sortorder === '4' ? [...(options.jobs ?? [])].reverse() : (options.jobs ?? [])
        const rows = jobs.slice((page - 1) * size, page * size) as { job_id?: string }[]
        return reply(
          200,
          rows.sort((a, b) => Number(a.job_id) - Number(b.job_id))
        )
      }
      case '/api/SalesApi/GetSalesApptDetailDateRange':
        return reply(200, options.appointments ?? [])
      case '/api/Customers/GetLead': {
        const leads = options.leads?.[form.cst_id!]
        return reply(200, leads ? [{ cst_id: form.cst_id, leads }] : [])
      }
    }
    return reply(404, { Message: `No HTTP resource was found that matches the request URI '${url}'.` })
  }) as typeof fetch

  const client = new LeadPerfectionClient(secrets, { fetch: fakeFetch, clock })
  return {
    client,
    calls,
    added,
    clock,
    // What LeadPerfection does to a token it no longer accepts, before its 24 hours are up.
    revokeTokens: () => issued.clear(),
    paths: () => calls.map((call) => new URL(call.url).pathname),
  }
}

type FakeAccount = Partial<AccountData> & { accountId: AccountId }

// An in-memory Terros account API: get, update (null clears a field, and onlyIfNoExternalLeadId fails with Conflict
// like the API's conditional save), match (accountId, then externalLeadId, then sourceId), list by ZIP code and
// upsert with a stage ID as workflowTarget. Writes are recorded, failed ones included.
export function fakeTerros(accounts: FakeAccount[] = []) {
  const store = new Map(accounts.map((account) => [account.accountId, { ...account }]))
  const writes: { route: string; input: unknown }[] = []
  let created = 0

  const notFound = (accountId: string) => {
    throw new Error(`Request to account/get failed: Account ${accountId} not found`)
  }
  const apply = (account: FakeAccount, changes: Record<string, unknown>) => {
    const { workflowTarget, ...rest } = changes
    Object.assign(account, rest, workflowTarget ? { workflowStageId: workflowTarget } : {})
    for (const [key, value] of Object.entries(rest)) if (value === null) delete account[key as keyof FakeAccount]
  }

  const account = {
    get: async ({ accountId }: { accountId: AccountId }) => ({
      type: 'success',
      account: store.get(accountId) ?? notFound(accountId),
    }),
    update: async (input: { account: FakeAccount; onlyIfNoExternalLeadId?: boolean }) => {
      writes.push({ route: 'account/update', input })
      const existing = store.get(input.account.accountId) ?? notFound(input.account.accountId)
      if (input.onlyIfNoExternalLeadId && existing.externalLeadId) {
        throw Object.assign(new Error('Conflict: The account already has an externalLeadId'), { code: 'Conflict' })
      }
      apply(existing, input.account)
      return { type: 'success', account: existing }
    },
    match: async (input: { accountId?: string; externalLeadId?: string; sourceId?: string }) => {
      const all = [...store.values()]
      const found =
        (input.accountId && store.get(input.accountId as AccountId)) ||
        (input.externalLeadId && all.find((a) => a.externalLeadId === input.externalLeadId)) ||
        (input.sourceId && all.find((a) => a.sourceId === input.sourceId)) ||
        undefined
      return { type: 'success', account: found }
    },
    list: async (input: { searchInput?: { zipCodes?: string[] } }) => ({
      type: 'success',
      accounts: [...store.values()].filter((a) => input.searchInput?.zipCodes?.includes(a.location?.postal1 ?? '')),
    }),
    upsert: async (input: { requestType: string; account: Record<string, unknown> & { accountId?: AccountId } }) => {
      writes.push({ route: 'account/upsert', input })
      const accountId = input.account.accountId
      if (accountId) {
        const existing = store.get(accountId) ?? notFound(accountId)
        apply(existing, input.account)
        return { type: 'success', account: existing }
      }
      if (input.requestType === 'update') throw new Error('Request to account/upsert failed: Account not found')
      const account: FakeAccount = { accountId: `Account.exampleCreated${++created}` }
      apply(account, input.account)
      store.set(account.accountId, account)
      return { type: 'success', account }
    },
  }
  return { terros: { account } as never, store, writes }
}
