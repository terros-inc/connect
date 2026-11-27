import { type AccountId, type CalendarEventId, type TerrosClient, wrapConnectHandler } from '@terros-inc/sdk'
import { apptotoRequest, findEvent, isNotFound, isOn, type Secrets } from './apptoto.ts'

type ScriptConfig = {
  calendarId: string
  disabled?: boolean | string
  dryRun?: boolean | string
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

type Participant = {
  name?: string
  phone?: string
  email?: string
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
      console.log(`DRY RUN: would delete Apptoto event for Terros event ${payload.data.id} on any calendar`)
      return
    }
    // No calendar check: external_id is unique per Apptoto account, so the match is this appointment's event even
    // if the install's calendar changed after it synced, and leaving it would send reminders for a cancelled appointment.
    try {
      await apptotoRequest(secrets, `/v1/events?external_id=${encodeURIComponent(payload.data.id)}`, {
        method: 'DELETE',
      })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    return
  }

  const event = payload.data
  const existing = await findEvent(secrets, { external_id: event.id })
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
    console.log(
      `DRY RUN: would upsert Apptoto event for Terros event ${event.id} on calendar ${scriptConfig.calendarId}`
    )
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
