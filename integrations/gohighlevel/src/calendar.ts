import {
  type AccountId,
  type CalendarEventId,
  type EventType,
  type SmallAddress,
  type TerrosClient,
  type UserId,
  wrapConnectHandler,
} from '@terros-inc/sdk'
import { ghlApi, isNotFound } from './util.ts'
import { findUserId, toContact } from './gohighlevel.ts'
import {
  countCreateAttempts,
  createNoteText,
  creatingMarker,
  isFreshMarker,
  MAX_APPOINTMENT_CREATES,
  realSourceId,
} from './creationGuard.ts'
import { checkConfig } from './configFields.ts'
import { isSwitchOn, type RunSwitches } from './config.ts'
import { sendAlert, type AlertConfig } from './alerts.ts'

type ScriptConfig = RunSwitches &
  AlertConfig & {
    locationId: string
    calendarId: string
  }

type Secrets = {
  privateIntegrationToken: string
}

type CalendarEventWebhookData = {
  id: CalendarEventId
  eventDate: string
  account?: {
    accountId: AccountId
    externalLeadId?: string
  }
  duration: number
  title: string
  eventType: EventType
  address?: SmallAddress
  attendee?: {
    userId?: UserId
    email?: string
  }
  sourceId?: string
}

type CalendarEventWebhook =
  | {
      entity: 'Event'
      action: 'add' | 'update'
      data: CalendarEventWebhookData
    }
  | {
      entity: 'Event'
      action: 'remove'
      // The backend hard-deletes the event and sends only its id; sourceId is read when a payload carries it.
      data: { id: CalendarEventId; sourceId?: string }
    }

type GoHighLevelAppointment = {
  id: string
  calendarId: string
  locationId: string
  contactId: string
  title: string
  startTime: string
  endTime: string
  appointmentStatus: string
  assignedUserId?: string
}

type GoHighLevelContact = {
  id: string
  locationId?: string
}

export const handler = wrapConnectHandler<CalendarEventWebhook, void, ScriptConfig>(async (input, client) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig
  const secrets = input.context.config.secrets as Secrets
  const accessToken = secrets.privateIntegrationToken

  if (isSwitchOn('disabled', scriptConfig.disabled)) {
    console.log(`GoHighLevel Appointment Sync is disabled by config, skipping Terros event ${payload.data.id}`)
    return
  }
  checkConfig('appointmentSync', scriptConfig)
  const dryRun = isSwitchOn('dryRun', scriptConfig.dryRun)

  if (payload.action === 'remove') {
    await cancelAppointment(client, accessToken, scriptConfig, payload.data.id, payload.data.sourceId, dryRun)
    return
  }

  const event = payload.data

  if (event.eventType !== 'Consultation') {
    console.log(`Skipping non-consultation Terros event ${event.id}`)
    return
  }

  if (!event.account) {
    console.log(`Skipping Terros event ${event.id}: no account yet`)
    return
  }
  const closer = event.attendee
  if (!closer) {
    console.log(`Skipping Terros event ${event.id}: no attendee yet`)
    return
  }

  if (isFreshMarker(event.sourceId, Date.now())) {
    console.log(`Skipping Terros event ${event.id}: a GoHighLevel appointment is already being created`)
    return
  }

  const { account } = await client.account.get({ accountId: event.account.accountId })

  const assignedUserId = await findUserId(accessToken, scriptConfig.locationId, closer.email)
  if (!assignedUserId) {
    throw Error(
      `No GoHighLevel user matches the attendee email ${closer.email ?? '(none)'} for Terros event ${event.id}`
    )
  }

  const appointmentInput = (contactId: string) => toAppointment(event, scriptConfig, contactId, assignedUserId)
  const linkedAppointmentId = realSourceId(event.sourceId)

  if (linkedAppointmentId) {
    // An event that already has an appointment id is never given a second appointment. Whatever is wrong with the
    // link (appointment missing, on another contact) is for a person to resolve, because creating a replacement
    // writes the event, which triggers this script again.
    const existingAppointment = await findAppointment(accessToken, linkedAppointmentId)
    if (!existingAppointment) {
      await refuse(
        scriptConfig,
        account.accountId,
        event.id,
        `GoHighLevel appointment ${linkedAppointmentId} for Terros event ${event.id} was not found, so no appointment was created or changed.`
      )
      return
    }
    const contactId = await findValidContactId(accessToken, scriptConfig.locationId, account.externalLeadId)
    if (!contactId || existingAppointment.contactId !== contactId) {
      await refuse(
        scriptConfig,
        account.accountId,
        event.id,
        `GoHighLevel appointment ${linkedAppointmentId} is on contact ${existingAppointment.contactId}, not the account's contact ${contactId ?? '(none)'}, so Terros event ${event.id} was not synced.`
      )
      return
    }

    const appointmentUpdate = getAppointmentUpdate(existingAppointment, appointmentInput(contactId))
    if (!appointmentUpdate) {
      console.log(`Skipped unchanged GoHighLevel appointment ${linkedAppointmentId}`)
      return
    }
    if (dryRun) {
      console.log(
        `DRY RUN: would update GoHighLevel appointment ${linkedAppointmentId}: ${JSON.stringify(appointmentUpdate)}`
      )
      return
    }
    await ghlApi<GoHighLevelAppointment>(accessToken, `/calendars/events/appointments/${linkedAppointmentId}`, {
      method: 'PUT',
      body: JSON.stringify(appointmentUpdate),
    })
    return
  }

  // No appointment yet (or a creation marker that expired): the only path that creates one.
  const attempts = countCreateAttempts(account.notes, event.id)
  if (attempts >= MAX_APPOINTMENT_CREATES) {
    await refuse(
      scriptConfig,
      account.accountId,
      event.id,
      `Terros event ${event.id} already had ${attempts} GoHighLevel appointment create attempts, so no more were made.`
    )
    return
  }
  const noteUserId = account.ownerId ?? closer.userId
  if (!noteUserId) {
    await refuse(
      scriptConfig,
      account.accountId,
      event.id,
      `Terros event ${event.id} has no owner or closer to record its appointment attempt under, so no appointment was created.`
    )
    return
  }
  if (dryRun) {
    console.log(
      `DRY RUN: would create a GoHighLevel appointment for Terros event ${event.id} at ${event.eventDate} for ${event.duration} minutes (attempt ${attempts + 1} of ${MAX_APPOINTMENT_CREATES}); nothing was written`
    )
    return
  }

  let contactId = await findValidContactId(accessToken, scriptConfig.locationId, account.externalLeadId)
  if (!contactId) {
    const contactInput = toContact(
      {
        address: account.location,
        resident: account.resident,
      },
      scriptConfig.locationId,
      undefined,
      assignedUserId
    )
    const contactResponse = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, '/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify(contactInput),
    })
    contactId = contactResponse.contact.id

    await client.account.upsert({
      requestType: 'update',
      account: {
        accountId: account.accountId,
        externalLeadId: contactId,
      },
    })
    console.log(`Saved contact ${contactId} to ${account.accountId}`)
  }
  console.log(`Using ${contactId} for ${event.id}`)

  // Claim the event before the POST, and read it back so a run that lost a race backs off. Not atomic (the API has
  // no compare-and-set), so the attempt count below is the hard limit.
  const marker = creatingMarker(Date.now())
  await client.calendar.event.update({ event: { eventId: event.id, sourceId: marker } })
  const { event: claimed } = await client.calendar.event.get({ eventId: event.id })
  if (claimed.sourceId !== marker) {
    console.log(`Skipping Terros event ${event.id}: another run is creating its GoHighLevel appointment`)
    return
  }

  await client.account.upsert({
    requestType: 'update',
    account: {
      accountId: account.accountId,
      notes: [{ timestamp: Date.now(), text: createNoteText(event.id, account.accountId), userId: noteUserId }],
    },
  })

  const createdAppointment = await ghlApi<GoHighLevelAppointment>(accessToken, '/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify(appointmentInput(contactId)),
  })
  await client.calendar.event.update({
    event: {
      eventId: event.id,
      sourceId: createdAppointment.id,
    },
  })
  console.log(`Created GoHighLevel appointment ${createdAppointment.id} for ${event.id}`)
})

async function refuse(
  config: AlertConfig,
  accountId: AccountId,
  eventId: CalendarEventId,
  message: string
): Promise<void> {
  console.log(message)
  await sendAlert(config, { accountId, eventId, stage: 'Appointment Sync', message })
}

// A miss logs only the status and top-level key names, never values, so it is diagnosable without personal data.
async function findAppointment(
  accessToken: string,
  appointmentId: string
): Promise<GoHighLevelAppointment | undefined> {
  try {
    const body = await ghlApi<{ event?: GoHighLevelAppointment }>(
      accessToken,
      `/calendars/events/appointments/${appointmentId}`
    )
    if (!body?.event) {
      console.log(
        `GoHighLevel appointment lookup for ${appointmentId} returned HTTP 200 without an event; top-level keys: ${Object.keys(body ?? {}).join(', ') || '(none)'}`
      )
    }
    return body?.event
  } catch (error) {
    if (!isNotFound(error)) throw error
    console.log(`GoHighLevel appointment lookup for ${appointmentId} returned HTTP 404`)
  }
}

// A contact id saved by another location or since deleted is not usable; the caller relinks via upsert.
async function findValidContactId(
  accessToken: string,
  locationId: string,
  externalLeadId: string | undefined
): Promise<string | undefined> {
  if (!externalLeadId) return

  try {
    const { contact } = await ghlApi<{ contact: GoHighLevelContact }>(accessToken, `/contacts/${externalLeadId}`)
    if (contact.locationId === locationId) return externalLeadId
    console.log(`Contact ${externalLeadId} belongs to location ${contact.locationId}, relinking`)
  } catch (error) {
    if (!isNotFound(error)) throw error
    console.log(`Contact ${externalLeadId} was not found, relinking`)
  }
}

// Terros hard-deletes removed events and ignores archive, so the event is normally gone; its appointment can only be
// found from a sourceId carried in the payload.
async function readSourceId(client: TerrosClient, eventId: CalendarEventId): Promise<string | undefined> {
  try {
    const { event } = await client.calendar.event.get({ eventId })
    return event.sourceId
  } catch (error) {
    console.log(`Could not read removed Terros event ${eventId}: ${error instanceof Error ? error.message : error}`)
  }
}

async function cancelAppointment(
  client: TerrosClient,
  accessToken: string,
  scriptConfig: ScriptConfig,
  eventId: CalendarEventId,
  payloadSourceId: string | undefined,
  dryRun: boolean
): Promise<void> {
  const sourceId = realSourceId(payloadSourceId ?? (await readSourceId(client, eventId)))
  if (!sourceId) {
    console.log(`Skipping removed Terros event ${eventId}: no GoHighLevel appointment`)
    return
  }

  const appointment = await findAppointment(accessToken, sourceId)
  if (!appointment || appointment.calendarId !== scriptConfig.calendarId) {
    console.log(`Skipping removed Terros event ${eventId}: ${sourceId} is not on the configured calendar`)
    return
  }
  if (appointment.appointmentStatus === 'cancelled') {
    console.log(`GoHighLevel appointment ${sourceId} is already cancelled`)
    return
  }
  if (dryRun) {
    console.log(`DRY RUN: would cancel GoHighLevel appointment ${sourceId} for removed Terros event ${eventId}`)
    return
  }

  await ghlApi<GoHighLevelAppointment>(accessToken, `/calendars/events/appointments/${sourceId}`, {
    method: 'PUT',
    body: JSON.stringify({ appointmentStatus: 'cancelled' }),
  })
  console.log(`Cancelled GoHighLevel appointment ${sourceId} for removed Terros event ${eventId}`)
}

type AppointmentEvent = Pick<CalendarEventWebhookData, 'title' | 'eventDate' | 'duration'>

type GoHighLevelAppointmentInput = {
  calendarId: string
  locationId: string
  contactId: string
  title: string
  startTime: string
  endTime: string
  appointmentStatus: 'confirmed'
  assignedUserId?: string
  meetingLocationType: 'gmeet'
  toNotify: true
  ignoreDateRange: true
  ignoreFreeSlotValidation: true
}

export function toAppointment(
  event: AppointmentEvent,
  config: Pick<ScriptConfig, 'locationId' | 'calendarId'>,
  contactId: string,
  assignedUserId: string | undefined
): GoHighLevelAppointmentInput {
  const startTime = new Date(event.eventDate)
  const endTime = new Date(startTime.getTime() + event.duration * 60_000)

  return {
    calendarId: config.calendarId,
    locationId: config.locationId,
    contactId,
    title: event.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    appointmentStatus: 'confirmed',
    assignedUserId,
    meetingLocationType: 'gmeet',
    toNotify: true,
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
  }
}

type GoHighLevelAppointmentUpdate = Partial<
  Pick<
    GoHighLevelAppointmentInput,
    'startTime' | 'endTime' | 'assignedUserId' | 'ignoreDateRange' | 'ignoreFreeSlotValidation'
  >
> & { toNotify?: true }

/**
 * GoHighLevel owns an existing appointment's status and title. Terros may only move it in time and fill in a missing
 * assignee; returns undefined when there is nothing to send.
 */
export function getAppointmentUpdate(
  appointment: GoHighLevelAppointment,
  input: GoHighLevelAppointmentInput
): GoHighLevelAppointmentUpdate | undefined {
  const timeChanged =
    new Date(appointment.startTime).getTime() !== new Date(input.startTime).getTime() ||
    new Date(appointment.endTime).getTime() !== new Date(input.endTime).getTime()
  const assigneeMissing = !appointment.assignedUserId && input.assignedUserId !== undefined
  if (!timeChanged && !assigneeMissing) return

  return {
    ...(timeChanged
      ? {
          startTime: input.startTime,
          endTime: input.endTime,
          toNotify: true,
          ignoreDateRange: true,
          ignoreFreeSlotValidation: true,
        }
      : {}),
    ...(assigneeMissing ? { assignedUserId: input.assignedUserId } : {}),
  }
}
