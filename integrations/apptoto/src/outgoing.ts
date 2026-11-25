import { type AccountId, type CalendarEventId, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'

const APPTOTO_API = 'https://api.apptoto.com'

type ScriptConfig = {
  calendarId: string
  disabled?: boolean | string
  dryRun?: boolean | string
}

type Secrets = {
  username: string
  apiKey: string
}

type EventData = {
  id: CalendarEventId
  title: string
  eventDate: string
  duration: number
  account?: { accountId: AccountId }
}

export type CalendarEventWebhook =
  | { entity: 'Event'; action: 'add' | 'update'; data: EventData }
  | { entity: 'Event'; action: 'remove'; data: { id: CalendarEventId } }

type ApptotoEvent = {
  id: number
  calendar_id: number | string
  external_id?: string
}

type Participant = {
  name?: string
  phone?: string
  email?: string
}

class ApptotoApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function value(record: Record<string, unknown>, key: string): string | undefined {
  const found = record[key]
  return typeof found === 'string' && found.trim() ? found.trim() : undefined
}

export function toParticipant(resident: Record<string, unknown> | undefined): Participant | undefined {
  if (!resident) return undefined
  const firstName = value(resident, 'firstName')
  const lastName = value(resident, 'lastName')
  const combinedName = [firstName, lastName].filter(Boolean).join(' ')
  const name = value(resident, 'name') ?? (combinedName || undefined)
  const phone = value(resident, 'phone')
  const email = value(resident, 'email')
  const participant = {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  }
  return Object.keys(participant).length ? participant : undefined
}

function authorization(secrets: Secrets): string {
  if (!secrets.username || !secrets.apiKey) throw new Error('Apptoto username and apiKey are required')
  return `Basic ${Buffer.from(`${secrets.username}:${secrets.apiKey}`).toString('base64')}`
}

async function apptotoRequest<T>(secrets: Secrets, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${APPTOTO_API}${path}`, {
    ...init,
    headers: {
      Authorization: authorization(secrets),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    throw new ApptotoApiError(
      `Apptoto rate limit exceeded${retryAfter ? `; retry after ${retryAfter}` : ''}`,
      response.status
    )
  }
  if (!response.ok) {
    throw new ApptotoApiError(`Apptoto ${init.method ?? 'GET'} ${path} failed with ${response.status}`, response.status)
  }
  return (await response.json()) as T
}

async function findEvent(secrets: Secrets, externalId: string): Promise<ApptotoEvent | undefined> {
  try {
    const result = await apptotoRequest<ApptotoEvent | { event: ApptotoEvent }>(
      secrets,
      `/v1/event?external_id=${encodeURIComponent(externalId)}`
    )
    return 'event' in result ? result.event : result
  } catch (error) {
    if (error instanceof ApptotoApiError && error.status === 404) return undefined
    throw error
  }
}

function isOn(value: boolean | string | undefined): boolean {
  return value === true || value === 'true'
}

export async function syncAppointment(
  payload: CalendarEventWebhook,
  client: TerrosClient,
  scriptConfig: ScriptConfig,
  secrets: Secrets
): Promise<void> {
  if (isOn(scriptConfig.disabled)) {
    console.log(`Apptoto Appointment Sync is disabled, skipping Terros event ${payload.data.id}`)
    return
  }
  if (!scriptConfig.calendarId) throw new Error('Apptoto calendarId is required')

  const dryRun = isOn(scriptConfig.dryRun)
  if (payload.action === 'remove') {
    if (dryRun) {
      console.log(`DRY RUN: would delete Apptoto event for Terros event ${payload.data.id}`)
      return
    }
    await apptotoRequest(secrets, `/v1/events?external_id=${encodeURIComponent(payload.data.id)}`, {
      method: 'DELETE',
    })
    return
  }

  const event = payload.data
  const existing = await findEvent(secrets, event.id)
  if (existing && String(existing.calendar_id) !== String(scriptConfig.calendarId)) {
    console.log(
      `Skipping Terros event ${event.id}: its Apptoto event is on calendar ${existing.calendar_id}, and Apptoto cannot move events to configured calendar ${scriptConfig.calendarId}`
    )
    return
  }
  if (!event.account) {
    console.log(`Skipping Terros event ${event.id}: no linked account`)
    return
  }

  const { account } = await client.account.get({ accountId: event.account.accountId })
  const participant = toParticipant(account.resident)
  if (!participant) {
    console.log(`Skipping Terros event ${event.id}: its linked account has no participant contact details`)
    return
  }
  const start = new Date(event.eventDate)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(event.duration) || event.duration < 0) {
    throw new Error(`Terros event ${event.id} has an invalid date or duration`)
  }
  const apptotoEvent = {
    external_id: event.id,
    calendar_id: scriptConfig.calendarId,
    title: event.title,
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + event.duration * 60_000).toISOString(),
    // Apptoto sends auto-messages when account templates are enabled; otherwise customers may opt in with #auto.
    participants: [participant],
  }
  if (dryRun) {
    console.log(`DRY RUN: would upsert Apptoto event for Terros event ${event.id}: ${JSON.stringify(apptotoEvent)}`)
    return
  }
  await apptotoRequest(secrets, '/v1/events', {
    method: 'PUT',
    body: JSON.stringify({ events: [apptotoEvent], prevent_calendar_creation: true }),
  })
}

export const handler = wrapConnectHandler<CalendarEventWebhook, void, ScriptConfig>(async (input, client) => {
  await syncAppointment(
    input.context.payload,
    client,
    input.context.config.scriptConfig,
    input.context.config.secrets as Secrets
  )
})
