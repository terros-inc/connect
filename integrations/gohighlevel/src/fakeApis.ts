// In-memory fake Terros API and fake GoHighLevel API behind a stubbed global fetch, for handler-level tests.
// Any host other than the two fakes throws, so a test can never reach a live system.
import { vi } from 'vitest'
import manifest from '../terros.json' with { type: 'json' }

export const LOCATION_ID = 'loc-1'
export const PIPELINE_ID = 'pipe-1'
export const CALENDAR_ID = 'cal-1'
export const COMPANY_ID = 'co-1'
/** The user the fake Terros API authenticates as; events owned by anyone else are invisible to an unscoped list. */
export const CONNECT_USER = 'U.connect-key'
export const GHL_STAGES = [
  { id: 'st-lead', name: 'Lead' },
  { id: 'st-appt', name: 'Appointment Set' },
  { id: 'st-sat', name: 'Sat' },
  { id: 'st-won', name: 'Closed Won' },
]

type Json = Record<string, any>

export class FakeApis {
  /** Mutating calls only, in order, e.g. `GHL PUT /opportunities/opp-1 {...}` */
  log: string[] = []
  blocked: string[] = []
  ghl = {
    contacts: new Map<string, Json>(),
    opps: new Map<string, Json>(),
    appts: new Map<string, Json>(),
    notes: new Map<string, Json[]>(),
    users: [
      {
        id: 'ghl-closer',
        email: 'closer@hq.test',
        firstName: 'Cora',
        lastName: 'Closer',
      },
      {
        id: 'ghl-sales',
        email: 'sales@hq.test',
        firstName: 'Sam',
        lastName: 'Sales',
      },
    ] as Json[],
    /** "METHOD /path-prefix" -> status, one-shot */
    failNext: new Map<string, number>(),
    /** How reading an appointment by id behaves: normally, as missing (404), or as belonging to another contact. */
    appointmentLookup: 'normal' as 'normal' | 'missing' | 'otherContact' | 'liveShape' | 'noAppointment',
  }
  terros = {
    accounts: new Map<string, Json>(),
    events: new Map<string, Json>(),
    knownStages: new Set(['Lead', 'Appointment Set', 'Sat', 'Closed Won']),
    /** When set, another run's creation marker replaces the one just written, as in a race. */
    stealClaimWith: undefined as string | undefined,
    /** The user the API key authenticates as, returned by user/profile; undefined makes that call fail. */
    profileUserId: CONNECT_USER as string | undefined,
  }
  /**
   * Permissions of the script under test, read from terros.json. Like the backend, the fake denies event and company
   * reads/writes the script did not request. Undefined means no enforcement.
   */
  permissions: Set<string> | undefined
  private n = 0
  asScript(slug: string) {
    const script = manifest.scripts.find((s) => s.slug === slug)
    if (!script) throw Error(`no script ${slug}`)
    this.permissions = new Set(script.permissions)
  }
  private lacks(permission: string): boolean {
    return this.permissions !== undefined && !this.permissions.has(permission)
  }

  id(prefix: string) {
    return `${prefix}-${++this.n}`
  }

  addAccount(a: Json & { accountId: string }) {
    const account = {
      workflowStageName: 'Appointment Set',
      resident: {
        firstName: 'Test',
        lastName: 'Homeowner',
        email: 'test@home.test',
        phone: '+15125550123',
      },
      location: {
        line1: '1 Main St',
        locality: 'Austin',
        countrySubd: 'TX',
        postal1: '78701',
      },
      closer: { userId: 'U.closer', email: 'closer@hq.test' },
      closerId: 'U.closer',
      ownerId: 'U.owner',
      notes: [],
      ...a,
    }
    // An account with no closer has no closerId either.
    if ('closer' in a && !a.closer && !('closerId' in a)) (account as Json).closerId = undefined
    this.terros.accounts.set(account.accountId, account)
    return account
  }
  addEvent(e: Json & { eventId: string }) {
    const event = {
      eventType: 'Consultation',
      ownerId: 'U.rep',
      title: 'Solar Consultation',
      eventDate: '2026-10-05T17:00:00.000Z',
      duration: 60,
      ...e,
    }
    this.terros.events.set(event.eventId, event)
    return event
  }
  accountWebhook(accountId: string, action: 'add' | 'update' = 'update') {
    const a = this.terros.accounts.get(accountId)!
    return {
      entity: 'Account',
      action,
      data: {
        id: a.accountId,
        workflowState: { stageName: a.workflowStageName },
        // The real payload carries owner and closer as objects and has no ownerId or closerId.
        owner: a.ownerId ? { userId: a.ownerId, email: `${a.ownerId}@hq.test` } : undefined,
        closer: a.closer,
        address: a.location,
        resident: a.resident,
        externalLeadId: a.externalLeadId,
        customFieldMap: a.customFields ?? {},
        notes: a.notes,
      },
    }
  }
  /** The backend sends only the id of a removed event; the event is already deleted when the script runs. */
  removeWebhook(eventId: string) {
    return { entity: 'Event', action: 'remove', data: { id: eventId } }
  }
  eventWebhook(eventId: string, action: 'add' | 'update' = 'update') {
    const e = this.terros.events.get(eventId)!
    return {
      entity: 'Event',
      action,
      data: {
        id: e.eventId,
        title: e.title,
        eventDate: e.eventDate,
        duration: e.duration,
        sourceId: e.sourceId,
        eventType: e.eventType,
        attendee: e.attendeeEmail ? { userId: 'U.closer', email: e.attendeeEmail } : undefined,
        account: e.accountId
          ? {
              accountId: e.accountId,
              externalLeadId: this.terros.accounts.get(e.accountId)?.externalLeadId,
            }
          : undefined,
      },
    }
  }

  addContact(id: string, extra: Json = {}) {
    this.ghl.contacts.set(id, { id, locationId: LOCATION_ID, ...extra })
  }
  addOpp(id: string, contactId: string, pipelineStageId: string, extra: Json = {}) {
    this.ghl.opps.set(id, {
      id,
      contactId,
      locationId: LOCATION_ID,
      pipelineId: PIPELINE_ID,
      pipelineStageId,
      name: 'Test Homeowner',
      assignedTo: 'ghl-closer',
      status: 'open',
      ...extra,
    })
  }
  addAppt(id: string, contactId: string, extra: Json = {}) {
    this.ghl.appts.set(id, {
      id,
      calendarId: CALENDAR_ID,
      locationId: LOCATION_ID,
      contactId,
      title: 'Solar Consultation',
      startTime: '2026-10-05T17:00:00.000Z',
      endTime: '2026-10-05T18:00:00.000Z',
      appointmentStatus: 'confirmed',
      assignedUserId: 'ghl-closer',
      ...extra,
    })
  }
  ghlWrites() {
    return this.log.filter((line) => line.startsWith('GHL'))
  }
  terrosWrites() {
    return this.log.filter((line) => line.startsWith('TERROS'))
  }

  install() {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const u = new URL(url)
      const method = (init.method ?? 'GET').toUpperCase()
      const body = init.body ? JSON.parse(init.body as string) : undefined
      let out: { status: number; json: Json }
      if (u.host === 'api.terros.com') out = this.terrosRoute(u.pathname.slice(1), body)
      else if (u.host === 'services.leadconnectorhq.com') out = this.ghlRoute(method, u.pathname, u.searchParams, body)
      else {
        this.blocked.push(url)
        throw new Error(`NETWORK BLOCKED: ${url}`)
      }
      return new Response(JSON.stringify(out.json), {
        status: out.status,
        statusText: out.status === 200 ? 'OK' : `HTTP ${out.status}`,
      })
    })
  }

  private terrosRoute(route: string, body: Json): { status: number; json: Json } {
    const ok = (json: Json = {}) => ({
      status: 200,
      json: { type: 'success', ...json },
    })
    const err = (error: string, message: string) => ({
      status: 200,
      json: { type: 'error', error, message },
    })
    if (
      ![
        'account/get',
        'account/match',
        'user/list',
        'user/profile',
        'calendar/event/get',
        'calendar/event/list',
        'company/get',
      ].includes(route)
    ) {
      this.log.push(`TERROS ${route} ${JSON.stringify(body)}`)
    }
    switch (route) {
      case 'account/get': {
        if (this.lacks('account:list')) return err('PermissionDenied', 'account:list required')
        const account = this.terros.accounts.get(body.accountId)
        return account ? ok({ account }) : err('NotFound', `no account ${body.accountId}`)
      }
      case 'account/match':
        return ok({
          account: [...this.terros.accounts.values()].find((a) => a.externalLeadId === body.externalLeadId),
        })
      case 'user/list':
        return ok({ users: [] })
      case 'user/profile':
        return this.terros.profileUserId
          ? ok({ user: { userId: this.terros.profileUserId }, company: { companyId: COMPANY_ID } })
          : err('PermissionDenied', 'user:read required')
      case 'account/upsert': {
        const a = body.account
        const account = this.terros.accounts.get(a.accountId)
        if (!account) return err('NotFound', `no account ${a.accountId}`)
        if (a.externalLeadId) account.externalLeadId = a.externalLeadId
        if (a.customFields) account.customFields = { ...account.customFields, ...a.customFields }
        if (a.notes) account.notes = [...account.notes, ...a.notes]
        if (a.workflowTarget) {
          const hit = [...this.terros.knownStages].find(
            (s) => s.toLowerCase() === String(a.workflowTarget).toLowerCase()
          )
          if (hit) account.workflowStageName = hit
        }
        return ok({ account })
      }
      case 'calendar/event/update': {
        const e = this.terros.events.get(body.event.eventId)
        Object.assign(e!, body.event)
        if (this.terros.stealClaimWith && String(body.event.sourceId).startsWith('pending:'))
          e!.sourceId = this.terros.stealClaimWith
        return ok({ event: e })
      }
      case 'company/get':
        if (this.lacks('company:read')) return err('PermissionDenied', 'company:read required')
        return ok({ company: { companyId: COMPANY_ID } })
      case 'calendar/event/get': {
        if (this.lacks('event:read')) return err('PermissionDenied', 'event:read required')
        const event = this.terros.events.get(body.eventId)
        return event ? ok({ event }) : err('NotFound', `no event ${body.eventId}`)
      }
      case 'calendar/event/list': {
        if (this.lacks('event:read')) return err('PermissionDenied', 'event:read required')
        // Like the backend, a list without a companyId returns only the authenticated user's own events.
        const companyScoped = body.companyId === COMPANY_ID
        const events = [...this.terros.events.values()].filter((e) => {
          const time = new Date(e.eventDate).getTime()
          return (
            (companyScoped || e.ownerId === CONNECT_USER) &&
            (body.eventType === undefined || e.eventType === body.eventType) &&
            (body.startTime === undefined || time >= body.startTime) &&
            (body.endTime === undefined || time <= body.endTime)
          )
        })
        return ok({ events })
      }
      case 'calendar/event/upsert': {
        // Like the real API, an unknown sourceId creates an account-less event owned by the Connect key.
        let event = body.event.eventId
          ? this.terros.events.get(body.event.eventId)
          : [...this.terros.events.values()].find((x) => x.sourceId === body.event.sourceId)
        if (!event)
          event = this.addEvent({
            eventId: this.id('Event'),
            ownerId: 'U.connect-key',
            ...body.event,
          })
        else Object.assign(event, body.event)
        return ok({ event })
      }
      case 'calendar/event/remove': {
        // The backend ignores archive and always hard-deletes; removing a Consultation needs event:manage.
        if (this.lacks('event:manage')) return err('PermissionDenied', 'event:manage required')
        if (!this.terros.events.delete(body.eventId)) return err('NotFound', `no event ${body.eventId}`)
        return ok()
      }
      default:
        return err('NotImplemented', route)
    }
  }

  private ghlRoute(method: string, path: string, q: URLSearchParams, body: Json): { status: number; json: Json } {
    if (method !== 'GET') this.log.push(`GHL ${method} ${path} ${JSON.stringify(body)}`)
    for (const [key, status] of this.ghl.failNext) {
      const [m, prefix] = key.split(' ')
      if (m === method && path.startsWith(prefix!)) {
        this.ghl.failNext.delete(key)
        return { status, json: { message: `injected ${status}` } }
      }
    }
    const notFound = { status: 404, json: { message: 'Not found' } }
    let m: RegExpMatchArray | null
    if ((m = path.match(/^\/locations\/([^/]+)$/)))
      return {
        status: 200,
        json: { location: { id: m[1], companyId: 'co-1' } },
      }
    if (path === '/users/search') {
      const ids = q.get('ids')?.split(',')
      const query = q.get('query')?.toLowerCase()
      const users = this.ghl.users.filter((u) =>
        ids ? ids.includes(u.id) : query ? u.email.toLowerCase().includes(query) : true
      )
      return { status: 200, json: { users } }
    }
    if (path === '/contacts/upsert') {
      const hit = [...this.ghl.contacts.values()].find(
        (c) =>
          c.locationId === body.locationId &&
          ((body.email && c.email === body.email) || (body.phone && c.phone === body.phone))
      )
      const id = hit?.id ?? this.id('contact')
      this.ghl.contacts.set(id, { ...hit, ...body, id })
      return {
        status: 200,
        json: { contact: { id, locationId: body.locationId } },
      }
    }
    if ((m = path.match(/^\/contacts\/([^/]+)\/notes$/))) {
      const list = this.ghl.notes.get(m[1]!) ?? []
      if (method === 'POST') {
        const note = {
          id: this.id('note'),
          contactId: m[1],
          dateAdded: new Date().toISOString(),
          ...body,
        }
        this.ghl.notes.set(m[1]!, [...list, note])
        return { status: 200, json: { note } }
      }
      return { status: 200, json: { notes: list } }
    }
    if ((m = path.match(/^\/contacts\/([^/]+)$/))) {
      const c = this.ghl.contacts.get(m[1]!)
      if (!c) return notFound
      if (method === 'PUT') Object.assign(c, body)
      return { status: 200, json: { contact: c } }
    }
    if (path === '/opportunities/pipelines') {
      return {
        status: 200,
        json: {
          pipelines: [{ id: PIPELINE_ID, locationId: LOCATION_ID, stages: GHL_STAGES }],
        },
      }
    }
    if (path === '/opportunities/search') {
      const opportunities = [...this.ghl.opps.values()].filter(
        (o) => o.contactId === q.get('contact_id') && o.pipelineId === q.get('pipeline_id')
      )
      return { status: 200, json: { opportunities } }
    }
    if (path === '/opportunities/' && method === 'POST') {
      const id = this.id('opp')
      this.ghl.opps.set(id, { id, ...body })
      return { status: 200, json: { opportunity: this.ghl.opps.get(id) } }
    }
    if ((m = path.match(/^\/opportunities\/([^/]+)$/)) && method === 'PUT') {
      const o = this.ghl.opps.get(m[1]!)
      if (!o) return notFound
      Object.assign(o, body)
      return { status: 200, json: { opportunity: o } }
    }
    if (path === '/calendars/events/appointments' && method === 'POST') {
      const contact = this.ghl.contacts.get(body.contactId)
      if (!contact || contact.locationId !== body.locationId)
        return { status: 400, json: { message: 'Contact not found' } }
      const id = this.id('appt')
      this.ghl.appts.set(id, { id, ...body })
      return { status: 200, json: { id, ...body } }
    }
    if ((m = path.match(/^\/calendars\/events\/appointments\/([^/]+)$/))) {
      const a = this.ghl.appts.get(m[1]!)
      if (!a) return notFound
      if (method === 'GET' && this.ghl.appointmentLookup === 'missing') return notFound
      if (method === 'GET' && this.ghl.appointmentLookup === 'otherContact')
        return { status: 200, json: { event: { ...a, contactId: 'contact-someone-else' } } }
      if (method === 'GET' && this.ghl.appointmentLookup === 'liveShape')
        return { status: 200, json: { appointment: a, traceId: 'trace-1' } }
      if (method === 'GET' && this.ghl.appointmentLookup === 'noAppointment')
        return { status: 200, json: { traceId: 'trace-1' } }
      if (method === 'PUT') Object.assign(a, body)
      return { status: 200, json: method === 'PUT' ? a : { event: a } }
    }
    return {
      status: 501,
      json: { message: `fake GHL: unhandled ${method} ${path}` },
    }
  }
}

export function makeInput(payload: unknown, scriptConfig: Json) {
  return {
    runId: 'ConnectRun.test' as const,
    context: {
      payload,
      config: {
        scriptConfig,
        secrets: { privateIntegrationToken: 'TEST-TOKEN' },
        authorization: 'ApiKey test',
      },
    },
  } as any
}
