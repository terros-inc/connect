import { type Clock, limiterForKey, type RateLimiter, systemClock } from './rateLimit.ts'

// AccuLynx API v2, https://apidocs.acculynx.com. Every call authenticates with one location's API key.
const baseUrl: string = 'https://api.acculynx.com/api/v2'

// The source name written on AccuLynx job external references, so a job can be traced back to its Terros account.
export const externalReferenceSource = 'Terros'

const maxAttempts = 3
const maxRetryWaitMs = 5000
const searchPageSize = 25
const maxSearchPages = 4
const dayMs = 24 * 60 * 60 * 1000

export type AccuLynxCreated = { id?: string; _link?: string }
export type AccuLynxExternalReference = { jobId?: string; source?: string; projectId?: string }
export type AccuLynxAddress = {
  street1?: string
  street2?: string
  city?: string
  zipCode?: string
  state?: { abbreviation?: string }
}
export type AccuLynxContact = { id?: string; crossReference?: string }
export type AccuLynxMilestone = { name?: string; duration?: { startDate?: string } }
export type AccuLynxJob = {
  id?: string
  locationAddress?: AccuLynxAddress
  contacts?: { isPrimary?: boolean; contact?: { firstName?: string; lastName?: string; companyName?: string } }[]
}

export class AccuLynxError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

type ClientOptions = {
  fetch?: typeof fetch
  clock?: Clock
  limiter?: RateLimiter
}

export class AccuLynxClient {
  private readonly fetch: typeof fetch
  private readonly clock: Clock
  private readonly limiter: RateLimiter

  constructor(
    private readonly apiKey: string,
    options: ClientOptions = {}
  ) {
    this.fetch = options.fetch ?? fetch
    this.clock = options.clock ?? systemClock
    this.limiter = options.limiter ?? limiterForKey(apiKey)
  }

  createContact(contact: Record<string, unknown>): Promise<AccuLynxCreated> {
    return this.request('POST', '/contacts', contact) as Promise<AccuLynxCreated>
  }

  createJob(job: Record<string, unknown>): Promise<AccuLynxCreated> {
    return this.request('POST', '/jobs', job) as Promise<AccuLynxCreated>
  }

  async createJobExternalReference(jobId: string, projectId: string): Promise<void> {
    await this.request('POST', '/jobs/external-references', { jobId, source: externalReferenceSource, projectId })
  }

  // A contact created by AccuLynx Send carries the Terros account ID as its crossReference. AccuLynx cannot look a
  // contact up by crossReference, so this searches contacts created since the account was, newest first, by name.
  async findContactByCrossReference(
    crossReference: string,
    searchTerm: string | undefined,
    createdSince: number
  ): Promise<AccuLynxContact | undefined> {
    const body = {
      ...(searchTerm ? { searchTerm } : {}),
      startDate: new Date(createdSince).toISOString(),
      endDate: new Date(this.clock.now() + dayMs).toISOString(),
      sort: { sortColumn: 'CreatedDate', sortDirection: 'Descending' },
    }
    for (let page = 0; page < maxSearchPages; page++) {
      const query = new URLSearchParams({ pageSize: String(searchPageSize), pageStartIndex: String(page) })
      const result = (await this.request('POST', `/contacts/search?${query}`, body)) as { items?: AccuLynxContact[] }
      const items = result?.items ?? []
      const match = items.find((contact) => contact.crossReference === crossReference)
      if (match) return match
      if (items.length < searchPageSize) return undefined
    }
    return undefined
  }

  async getContactJobIds(contactId: string): Promise<string[]> {
    const result = (await this.request('GET', `/contacts/${encodeURIComponent(contactId)}/jobs`)) as {
      items?: { id?: string }[]
    }
    return (result?.items ?? []).map((job) => job.id).filter((id): id is string => !!id)
  }

  // Undefined when this key cannot see the job: it is in another location, does not exist, or is not returned.
  async getCurrentJobMilestone(jobId: string): Promise<AccuLynxMilestone | undefined> {
    try {
      return (await this.request('GET', `/jobs/${encodeURIComponent(jobId)}/milestones/current`)) as AccuLynxMilestone
    } catch (error) {
      if (error instanceof AccuLynxError && error.status === 404) return undefined
      throw error
    }
  }

  async getJobExternalReferences(jobId: string): Promise<AccuLynxExternalReference[]> {
    const query = new URLSearchParams({ jobId, source: externalReferenceSource })
    const references = await this.request('GET', `/jobs/external-references?${query}`)
    return Array.isArray(references) ? (references as AccuLynxExternalReference[]) : []
  }

  // AccuLynx does not return unassigned jobs (new jobs start unassigned), so a missing job is not an error here.
  async getJob(jobId: string): Promise<AccuLynxJob | undefined> {
    try {
      return (await this.request('GET', `/jobs/${encodeURIComponent(jobId)}?includes=contact`)) as AccuLynxJob
    } catch (error) {
      if (error instanceof AccuLynxError && error.status === 404) return undefined
      throw error
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      await this.limiter.acquire()
      const response = await this.fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      if (response.status === 429 && attempt < maxAttempts) {
        const waitMs = getRetryWaitMs(response.headers)
        console.log(`AccuLynx ${method} ${path} was rate limited; retrying in ${waitMs}ms`)
        await this.clock.sleep(waitMs)
        continue
      }

      if (!response.ok) {
        const text = await response.text()
        throw new AccuLynxError(
          `AccuLynx ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`,
          response.status
        )
      }

      const text = await response.text()
      return text ? JSON.parse(text) : undefined
    }
  }
}

function getRetryWaitMs(headers: Headers): number {
  const seconds = Number(headers.get('Retry-After') ?? headers.get('RateLimit-Reset'))
  if (!Number.isFinite(seconds) || seconds <= 0) return 1000
  return Math.min(seconds * 1000, maxRetryWaitMs)
}
