import {
  type AccountId,
  type AccountNote,
  type TerrosClient,
  type UnsavedAccountNote,
  type UserId,
} from '@terros-inc/sdk'

/** Notes starting with this are sync bookkeeping and are never copied to GoHighLevel. */
export const ALERT_NOTE_PREFIX = '[GoHighLevel sync alert]'

export type AlertConfig = {
  alertWebhookUrl?: string
  alertRecipients?: string
}

type Alert = {
  accountId: string
  stage: string
  message: string
}

/**
 * Scripts have no email sender, so an alert is an explicit error log line plus, when configured, a JSON POST to
 * alertWebhookUrl (for example a GoHighLevel inbound-webhook workflow or Slack/Zapier that mails alertRecipients).
 * A delivery failure is logged, never thrown, so it cannot break the sync.
 */
export async function sendAlert(config: AlertConfig, alert: Alert): Promise<void> {
  const recipients = splitList(config.alertRecipients)
  console.error(`GHL_SYNC_ALERT ${JSON.stringify({ ...alert, recipients })}`)

  if (!config.alertWebhookUrl) return
  try {
    const response = await fetch(config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: alert.message, ...alert, recipients }),
    })
    if (!response.ok) console.error(`GHL_SYNC_ALERT delivery failed: ${response.status} ${response.statusText}`)
  } catch (error) {
    console.error(`GHL_SYNC_ALERT delivery failed: ${error instanceof Error ? error.message : error}`)
  }
}

export function alertNoteText(accountId: string, kind: string): string {
  return `${ALERT_NOTE_PREFIX} ${kind} (${accountId})`
}

export function hasAlertNote(notes: readonly Pick<AccountNote, 'text'>[] | undefined, kind: string): boolean {
  return (notes ?? []).some((note) => note.text.startsWith(`${ALERT_NOTE_PREFIX} ${kind} `))
}

/** Records that an alert was sent so later saves of the same account do not repeat it. */
export async function saveAlertNote(
  client: TerrosClient,
  accountId: AccountId,
  kind: string,
  userId: UserId | undefined
): Promise<void> {
  if (!userId) {
    console.log(`Cannot record the alert on ${accountId}: no owner, so it may repeat`)
    return
  }
  const note: UnsavedAccountNote = { timestamp: Date.now(), text: alertNoteText(accountId, kind), userId }
  await client.account.upsert({ requestType: 'update', account: { accountId, notes: [note] } })
}

export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
