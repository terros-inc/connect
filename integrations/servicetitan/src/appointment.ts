import { wrapConnectHandler } from '@terros-inc/sdk'
import { skipReason, sync, type CalendarEventWebhook, type Outcome } from './sync.ts'
import { ServiceTitanClient } from './servicetitan.ts'
import { PermanentError } from './errors.ts'
import { parseConfig, parseSecrets, type RawConfig } from './config.ts'

const log = (level: 'info' | 'warn' | 'error', message: string): void => console[level](message)

export const handler = wrapConnectHandler<CalendarEventWebhook, void, RawConfig>(async (input, client) => {
  const payload = input.context.payload
  const reason = skipReason(payload)
  if (reason) {
    console.info(`ServiceTitan sync skipped: ${reason}`)
    return
  }
  let outcome: Outcome
  try {
    const config = parseConfig(input.context.config.scriptConfig)
    const api = new ServiceTitanClient(parseSecrets(input.context.config.secrets))
    outcome = await sync(payload, config, api, {
      readAccount: async (accountId) => (await client.account.get({ accountId })).account,
      writeAccountCustomField: async (accountId, customFields) => {
        await client.account.update({ account: { accountId, customFields } })
      },
      writeEventSourceId: async (eventId, sourceId) => {
        await client.calendar.event.update({ event: { eventId, sourceId } })
      },
      log,
    })
  } catch (error) {
    // Terminal: the same input fails the same way, so it is logged and acknowledged rather than rethrown.
    if (error instanceof PermanentError) {
      console.error(`ServiceTitan sync failed permanently: ${error.message}`)
      return
    }
    throw error
  }
  if (outcome.kind === 'skipped') console.info(`ServiceTitan sync skipped: ${outcome.reason}`)
  else if (outcome.kind === 'unchanged') console.info('ServiceTitan sync no-op: unchanged')
  else console.info(`ServiceTitan sync wrote changes: ${JSON.stringify(outcome)}`)
})
