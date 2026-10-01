import { type AccountNote } from '@terros-inc/sdk'
import { ALERT_NOTE_PREFIX } from './alerts.ts'

// A Terros event's sourceId holds the GoHighLevel appointment id. While an appointment is being created it holds
// this marker instead, so a run triggered by the write itself, or racing it, can see that a create is in flight.
const MARKER_PREFIX = 'pending:'
export const MARKER_TTL_MS = 60_000
/** Appointments the sync may ever create for one Terros event. Counted per creation attempt, not per success. */
export const MAX_APPOINTMENT_CREATES = 2

export function creatingMarker(now: number, nonce: string = crypto.randomUUID().slice(0, 8)): string {
  return `${MARKER_PREFIX}${now}:${nonce}`
}

export function isCreatingMarker(sourceId: string | undefined): sourceId is string {
  return sourceId?.startsWith(MARKER_PREFIX) ?? false
}

/** A marker younger than MARKER_TTL_MS means a create is in flight; an older or malformed one counts as absent. */
export function isFreshMarker(sourceId: string | undefined, now: number): boolean {
  if (!isCreatingMarker(sourceId)) return false
  const timestamp = Number(sourceId.slice(MARKER_PREFIX.length).split(':')[0])
  return Number.isFinite(timestamp) && Math.abs(now - timestamp) < MARKER_TTL_MS
}

/** The real GoHighLevel appointment id on an event, ignoring a marker. */
export function realSourceId(sourceId: string | undefined): string | undefined {
  return sourceId && !isCreatingMarker(sourceId) ? sourceId : undefined
}

// The creation count lives in bookkeeping notes on the Terros account (one per attempt). Notes starting with
// ALERT_NOTE_PREFIX are never copied to GoHighLevel, and the account is the one record that survives an event
// update, a retried run and a version change.
const createNoteKind = 'appointment create attempt'

export function createNoteText(eventId: string, accountId: string): string {
  return `${ALERT_NOTE_PREFIX} ${createNoteKind} ${eventId} (${accountId})`
}

export function countCreateAttempts(notes: readonly Pick<AccountNote, 'text'>[] | undefined, eventId: string): number {
  const prefix = `${ALERT_NOTE_PREFIX} ${createNoteKind} ${eventId} `
  return (notes ?? []).filter((note) => note.text.startsWith(prefix)).length
}
