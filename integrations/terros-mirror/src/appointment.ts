import { type AccountId, type CalendarEventId, type EventType, wrapConnectHandler } from '@terros-inc/sdk'
import { targetClient } from './target.ts'

type EventWebhook =
  | {
      entity: 'Event'
      action: 'add' | 'update'
      data: {
        id: CalendarEventId
        title: string
        eventDate: string
        duration: number
        eventType: EventType
        note?: string
        account?: { accountId: AccountId }
      }
    }
  | { entity: 'Event'; action: 'remove'; data: { id: CalendarEventId } }

export const handler = wrapConnectHandler<EventWebhook>(async (input) => {
  const { payload, config } = input.context
  if (payload.action !== 'add') return
  const event = payload.data
  if (!event.account) return

  const target = targetClient(config.secrets)
  const { account } = await target.account.match({ sourceId: event.account.accountId })
  // An account and its appointment are often booked together, so this event can arrive before the account copy
  // lands. Failing (not creating the account here) keeps the two scripts from racing to create two accounts; the
  // retry finds the copy.
  if (!account) throw new Error(`Account ${event.account.accountId} has not been copied to the target company yet`)

  // `calendar/event/upsert` matches an existing event by `sourceId`, so a repeated event creates no second appointment.
  const { event: copy } = await target.calendar.event.upsert({
    event: {
      sourceId: event.id,
      accountId: account.accountId,
      title: event.title,
      eventType: event.eventType,
      eventDate: Number(event.eventDate),
      duration: event.duration,
      notes: event.note,
    },
  })
  console.log(`Copied appointment ${event.id} to target appointment ${copy.eventId}`)
})
