import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { IntegrationError, PermanentError } from '@terros-inc/sdk'

export type LeadPerfectionSecrets = {
  server: string
  clientId: string
  appKey: string
  username: string
  password: string
}

type Clock = { now: () => number }
type Options = { fetch?: typeof fetch; clock?: Clock }
type FormValue = string | number | undefined
type Reply = { status: number; text: string }

// The docs' LeadAdd fields this app sends.
export type LeadAddRequest = {
  firstname: string
  lastname: string
  address1?: string
  city?: string
  state?: string
  zip?: string
  phone?: string
  email?: string
  productID?: string
  sender?: string
  lognumber: string
  srs_id: number
  brn_id?: string
  notes?: string
  user1?: string
  user2?: string
  pro_id?: number
  apptdate?: string
  appttime?: string
}

// One row of GetJobStatusChanges: a job and its customer, flattened. Values are strings, dates are local ISO times.
export type JobStatusChange = {
  cst_id: string
  job_id: string
  jobstatus?: string
  disposition?: string
  entrydate?: string
  apptdate?: string
  contractdate?: string
  firstname?: string
  lastname?: string
  address1?: string
  city?: string
  state?: string
  zip?: string
  phone1?: string
  email?: string
}

// One row of GetSalesApptDetailDateRange: an issued appointment and its result (Disposition).
export type SalesAppointment = {
  ID: number
  Cst_ID: number
  ApptDate?: string
  Disposition?: string
  firstname?: string
  lastname?: string
  Address1?: string
  City?: string
  State?: string
  zip?: string
  Phone?: string
  email?: string
}

// The two link fields of a GetLead lead: lognumber is what the sender put on LeadAdd, in1_id the inbound lead ID
// LeadAdd returned.
export type LeadLink = { lognumber?: string; in1_id?: string }

type LeadAddReply = { id?: number; Status?: number; Message?: string }

const RENEW_BEFORE_EXPIRY_MS = 10 * 60_000

// Tokens last 24 hours and only work on the server and for the user that got them. Scripts of different installs
// can share a warm runtime, so the cache is keyed by every credential and never held in a single shared field.
const tokens = new Map<string, { accessToken: string; renewAt: number }>()

export function readSecrets(secrets: Record<string, string> | undefined): LeadPerfectionSecrets {
  const value = (name: keyof LeadPerfectionSecrets) => {
    const text = secrets?.[name]?.trim()
    if (!text) throw new IntegrationError(`The LeadPerfection install secret ${name} is missing`)
    return text
  }
  const server = value('server').toLowerCase()
  // The server becomes the host name, so anything but a bare prefix such as api2 or apitest could send the
  // credentials elsewhere.
  if (!/^[a-z0-9-]+$/.test(server)) {
    throw new IntegrationError(`The LeadPerfection server must be a prefix such as api, api2, api3 or apitest`)
  }
  return {
    server,
    clientId: value('clientId'),
    appKey: value('appKey'),
    username: value('username'),
    password: value('password'),
  }
}

export class LeadPerfectionClient {
  private readonly baseUrl: string
  private readonly cacheKey: string
  private readonly fetch: typeof fetch
  private readonly clock: Clock

  constructor(
    private readonly secrets: LeadPerfectionSecrets,
    options: Options = {}
  ) {
    this.baseUrl = `https://${secrets.server}.leadperfection.com`
    this.cacheKey = createHash('sha256').update(JSON.stringify(secrets)).digest('hex')
    this.fetch = options.fetch ?? fetch
    this.clock = options.clock ?? Date
  }

  async leadAdd(lead: LeadAddRequest): Promise<number> {
    const replies = await this.call<LeadAddReply[]>('/api/Leads/LeadAdd', lead)
    const reply = replies[0]
    if (reply?.Status !== 1 || !reply.id) {
      throw new IntegrationError(`LeadPerfection refused the lead: ${reply?.Message ?? JSON.stringify(replies)}`)
    }
    return reply.id
  }

  // StartIndex is a page number, not a record offset. Reads the newest maxPages pages at most and returns them
  // oldest page first; complete is false when older pages may remain.
  async getJobStatusChanges(
    startdate: string,
    enddate: string,
    pageSize: number,
    maxPages: number
  ): Promise<{ rows: JobStatusChange[]; complete: boolean }> {
    const pages: JobStatusChange[][] = []
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.call<JobStatusChange[]>('/api/Customers/GetJobStatusChanges', {
        startdate,
        enddate,
        // Status date descending, so the pages this reads are the newest when the window holds more. The sandbox
        // picks each page's rows by status date but returns them in job ID order.
        sortorder: 4,
        PageSize: pageSize,
        StartIndex: page,
      })
      pages.push(batch)
      if (batch.length < pageSize) return { rows: pages.reverse().flat(), complete: true }
    }
    return { rows: pages.reverse().flat(), complete: false }
  }

  // Not paged: the whole range comes back at once.
  getSalesAppointments(apptdates: string, apptdatee: string): Promise<SalesAppointment[]> {
    return this.call('/api/SalesApi/GetSalesApptDetailDateRange', { apptdates, apptdatee })
  }

  async getLeadLinks(cstId: string): Promise<LeadLink[]> {
    const customers = await this.call<{ leads?: LeadLink[] }[]>('/api/Customers/GetLead', {
      cst_id: cstId,
      PageSize: 1,
      StartIndex: 1,
    })
    return customers.flatMap((customer) => customer.leads ?? [])
  }

  private async call<T>(path: string, body: Record<string, FormValue>): Promise<T> {
    let reply = await this.post(path, body, await this.token())
    if (isTokenRefused(reply)) {
      tokens.delete(this.cacheKey)
      reply = await this.post(path, body, await this.token())
    }
    return parseReply<T>(path, reply)
  }

  private async token(): Promise<string> {
    const cached = tokens.get(this.cacheKey)
    if (cached && this.clock.now() < cached.renewAt) return cached.accessToken

    const reply = await this.post('/token', {
      grant_type: 'password',
      username: this.secrets.username,
      password: this.secrets.password,
      clientid: this.secrets.clientId,
      appkey: this.secrets.appKey,
    })
    if (reply.status === 429 || reply.status >= 500) {
      throw new Error(`LeadPerfection /token returned ${reply.status}: ${readMessage(reply.text)}`)
    }
    if (reply.status !== 200) {
      throw new IntegrationError(
        `LeadPerfection refused the install credentials on ${this.secrets.server}: ${readMessage(reply.text)}. ` +
          'Check the server, clientId, appKey, username and password secrets.'
      )
    }
    const { access_token, expires_in } = JSON.parse(reply.text) as { access_token?: string; expires_in?: number }
    if (!access_token) throw new Error('LeadPerfection /token returned no access_token')
    tokens.set(this.cacheKey, {
      accessToken: access_token,
      renewAt: this.clock.now() + (expires_in ?? 86_400) * 1000 - RENEW_BEFORE_EXPIRY_MS,
    })
    return access_token
  }

  private async post(path: string, body: Record<string, FormValue>, token?: string): Promise<Reply> {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) if (value !== undefined) form.set(key, String(value))
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form.toString(),
    })
    return { status: response.status, text: await response.text() }
  }
}

function isTokenRefused(reply: Reply): boolean {
  return reply.status === 403 || /invalid token/i.test(readMessage(reply.text))
}

function parseReply<T>(path: string, reply: Reply): T {
  const message = readMessage(reply.text)
  if (/do not have permission/i.test(message)) {
    const action = path.split('/').pop()
    throw new IntegrationError(
      `The LeadPerfection user may not run ${action}. Ask the LeadPerfection security admin to grant it the ` +
        `APISECURITY function permission for ${action}.`
    )
  }
  if (reply.status === 429 || reply.status >= 500 || reply.status === 401 || reply.status === 403) {
    throw new Error(`LeadPerfection ${path} returned ${reply.status}: ${message}`)
  }
  if (reply.status !== 200) throw new PermanentError(`LeadPerfection ${path} returned ${reply.status}: ${message}`)
  return JSON.parse(reply.text) as T
}

function readMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { Message?: string; message?: string; error_description?: string }
    return body.Message ?? body.message ?? body.error_description ?? text
  } catch {
    return text
  }
}

// LeadPerfection reads request dates as MM/DD/YYYY.
export function toLeadPerfectionDate(date: DateTime): string {
  return date.toFormat('MM/dd/yyyy')
}

// LeadPerfection returns dates as ISO local times without an offset, such as 2019-06-09T15:00:00.
export function fromLeadPerfectionDate(value: string | undefined, zone: string): number | undefined {
  if (!value?.trim()) return undefined
  const date = DateTime.fromISO(value.trim(), { zone })
  return date.isValid ? date.toMillis() : undefined
}
