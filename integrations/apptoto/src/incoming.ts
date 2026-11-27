import {
  type CalendarEventDataWithDetails,
  type CalendarEventId,
  type TerrosClient,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { type ApptotoEvent, findEvent, isOn, type Secrets } from './apptoto.ts'

type ScriptConfig = {
  calendarId: string
  responseStageMappings?: Record<string, string>
  disabled?: boolean | string
  dryRun?: boolean | string
}

type ApptotoParticipant = {
  id: number
  event_id: number
  state?: string
  event?: Partial<ApptotoEvent>
}

export type ApptotoWebhook = {
  event?: ApptotoEvent
  participant?: ApptotoParticipant
  apptoto_id?: string
}

type ParticipantResponse = 'participant_confirmed' | 'participant_not_coming' | 'participant_needs_reschedule'

// Payloads carry no event type, so the participant's state tells which response webhook fired.
const responseByState: Record<string, ParticipantResponse> = {
  confirmed: 'participant_confirmed',
  not_coming: 'participant_not_coming',
  not_coming_no_reschedule: 'participant_not_coming',
  not_coming_needs_reschedule: 'participant_needs_reschedule',
}

// Every write below sets a value from the payload rather than applying a delta, so a redelivered webhook repeats the
// same write. Apptoto's apptoto_id changes on each delivery attempt, so nothing keys on it.
export async function applyWebhook(
  payload: ApptotoWebhook,
  client: TerrosClient,
  scriptConfig: ScriptConfig,
  secrets: Secrets
): Promise<void> {
  if (isOn(scriptConfig.disabled)) {
    console.log('Apptoto Appointment Webhook is disabled, skipping')
    return
  }
  if (!scriptConfig.calendarId) throw new Error('Apptoto calendarId is required')

  if (payload.participant) return applyResponse(payload.participant, client, scriptConfig, secrets)
  if (payload.event) return applyEventChange(payload.event, client, scriptConfig)
  console.log(`Skipping Apptoto webhook with fields ${Object.keys(payload).sort().join(', ') || '(none)'}`)
}

async function applyResponse(
  participant: ApptotoParticipant,
  client: TerrosClient,
  scriptConfig: ScriptConfig,
  secrets: Secrets
): Promise<void> {
  const response = participant.state ? responseByState[participant.state] : undefined
  if (!response) {
    console.log(`Skipping Apptoto participant ${participant.id}: state ${participant.state ?? '(none)'} is not handled`)
    return
  }
  // The participant webhook nests only a summary of its event, without external_id.
  const apptotoEvent = participant.event?.external_id
    ? participant.event
    : await findEvent(secrets, { id: participant.event_id })
  if (!apptotoEvent) {
    console.log(`Skipping Apptoto participant ${participant.id}: Apptoto event ${participant.event_id} was not found`)
    return
  }
  const event = await findLinkedEvent(client, scriptConfig, { ...apptotoEvent, id: participant.event_id })
  if (!event) return

  // Terros events have no current field for a reminder response (notes and outcomeId are deprecated), so only the
  // mapped account stage records it.
  const stage = scriptConfig.responseStageMappings?.[response]?.trim()
  if (!stage) {
    console.log(`${response} for ${event.eventId}: no stage is mapped, so the account stage is unchanged`)
    return
  }
  if (!event.accountId) {
    console.log(`${response} for ${event.eventId}: the event has no linked account, skipping`)
    return
  }
  if (isOn(scriptConfig.dryRun)) {
    console.log(`DRY RUN: would move ${event.accountId} to ${stage} for ${response} on ${event.eventId}`)
    return
  }
  await client.account.upsert({
    requestType: 'update',
    account: { accountId: event.accountId, workflowTarget: stage, lastActionDate: Date.now() },
  })
  console.log(`Moved ${event.accountId} to ${stage} for ${response} on ${event.eventId}`)
}

async function applyEventChange(
  apptotoEvent: ApptotoEvent,
  client: TerrosClient,
  scriptConfig: ScriptConfig
): Promise<void> {
  const event = await findLinkedEvent(client, scriptConfig, apptotoEvent)
  if (!event) return
  const dryRun = isOn(scriptConfig.dryRun)

  if (apptotoEvent.is_deleted) {
    if (dryRun) {
      console.log(`DRY RUN: would remove ${event.eventId} for deleted Apptoto event ${apptotoEvent.id}`)
      return
    }
    await client.calendar.event.remove({ eventId: event.eventId })
    console.log(`Removed ${event.eventId} for deleted Apptoto event ${apptotoEvent.id}`)
    return
  }

  const time = toEventTime(apptotoEvent)
  // Also stops the echo of Apptoto Appointment Sync's own write, which reports the time Terros already has.
  if (event.eventDate === time.eventDate && event.duration === time.duration) {
    console.log(`${event.eventId} already matches Apptoto event ${apptotoEvent.id}'s time, skipping`)
    return
  }
  if (dryRun) {
    console.log(`DRY RUN: would move ${event.eventId} to ${JSON.stringify(time)} from Apptoto event ${apptotoEvent.id}`)
    return
  }
  await client.calendar.event.upsert({ event: { eventId: event.eventId, ...time } })
  console.log(`Moved ${event.eventId} to ${JSON.stringify(time)} from Apptoto event ${apptotoEvent.id}`)
}

// Finds the Terros event whose ID Apptoto Appointment Sync set as the Apptoto event's external_id. It never creates
// one: an event booked in Apptoto alone, or synced there from another calendar, is skipped.
async function findLinkedEvent(
  client: TerrosClient,
  scriptConfig: ScriptConfig,
  apptotoEvent: Partial<ApptotoEvent> & { id: number }
): Promise<CalendarEventDataWithDetails | undefined> {
  if (String(apptotoEvent.calendar_id) !== String(scriptConfig.calendarId)) {
    console.log(
      `Skipping Apptoto event ${apptotoEvent.id}: calendar ${apptotoEvent.calendar_id} is not configured calendar ${scriptConfig.calendarId}`
    )
    return
  }
  const externalId = apptotoEvent.external_id
  if (externalId && /^Event[.:]/.test(externalId)) {
    try {
      const { event } = await client.calendar.event.get({ eventId: externalId as CalendarEventId })
      return event
    } catch (error) {
      if (!isTerrosNotFound(error)) throw error
    }
  }
  console.log(`Skipping Apptoto event ${apptotoEvent.id}: no Terros event matches its external_id`)
}

function isTerrosNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'TerrosApiError' && (error as { code?: unknown }).code === 'NotFound'
}

export function toEventTime(apptotoEvent: Pick<ApptotoEvent, 'id' | 'start_time' | 'end_time'>): {
  eventDate: number
  duration: number
} {
  const start = Date.parse(apptotoEvent.start_time ?? '')
  const end = Date.parse(apptotoEvent.end_time ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`Apptoto event ${apptotoEvent.id} has an invalid start_time or end_time`)
  }
  return { eventDate: start, duration: Math.round((end - start) / 60_000) }
}

export const handler = wrapConnectHandler<ApptotoWebhook, void, ScriptConfig>(async (input, client) => {
  await applyWebhook(
    input.context.payload,
    client,
    input.context.config.scriptConfig,
    input.context.config.secrets as Secrets
  )
})
