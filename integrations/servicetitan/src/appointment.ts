import { wrapConnectHandler } from '@terros-inc/sdk'
import { skipReason, sync, type CalendarEventWebhook } from './sync.ts'
import { ServiceTitanClient } from './servicetitan.ts'
import { parseConfig, parseSecrets, type RawConfig } from './config.ts'

export const handler = wrapConnectHandler<CalendarEventWebhook, void, RawConfig>(async (input, client) => {
  const payload = input.context.payload
  const reason = skipReason(payload)
  if (reason) {
    console.info(`ServiceTitan sync skipped: ${reason}`)
    return
  }
  const config = parseConfig(input.context.config.scriptConfig)
  const api = new ServiceTitanClient(parseSecrets(input.context.config.secrets))
  const outcome = await sync(payload, config, api, {
    readAccount: async (accountId) => (await client.account.get({ accountId })).account,
    writeAccountCustomField: async (accountId, customFields) => {
      await client.account.update({ account: { accountId, customFields } })
    },
    writeEventSourceId: async (eventId, sourceId) => {
      await client.calendar.event.update({ event: { eventId, sourceId } })
    },
  })
  if (outcome.kind === 'skipped') console.info(`ServiceTitan sync skipped: ${outcome.reason}`)
  else if (outcome.kind === 'unchanged') console.info('ServiceTitan sync no-op: unchanged')
  else console.info(`ServiceTitan sync wrote changes: ${JSON.stringify(outcome)}`)
})
