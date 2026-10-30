import { wrapConnectHandler } from '@terros-inc/sdk'
import { skipReason, sync, type CalendarEventWebhook, type Outcome, type Ports } from './sync.ts'
import { RunBudget, ServiceTitanClient } from './servicetitan.ts'
import { PermanentError } from './errors.ts'
import { installDryRun } from './dryRun.ts'
import { parseConfig, parseSecrets, type RawConfig } from './config.ts'

const log = (level: 'info' | 'warn' | 'error', message: string): void => console[level](message)

export const handler = wrapConnectHandler<CalendarEventWebhook, void, RawConfig>(async (input, client) => {
  const payload = input.context.payload
  const reason = skipReason(payload)
  const event = payload.action === 'remove' ? undefined : payload.data
  if (reason || !event?.account) {
    console.info(`ServiceTitan sync skipped: ${reason ?? 'missing account'}`)
    return
  }
  let outcome: Outcome
  let dryRun = false
  try {
    const config = parseConfig(input.context.config.scriptConfig)
    dryRun = config.dryRun
    const secrets = parseSecrets(input.context.config.secrets)
    let ports: Ports = {
      readAccount: async (accountId) => (await client.account.get({ accountId })).account,
      writeAccountCustomField: async (accountId, customFields) => {
        await client.account.update({ account: { accountId, customFields } })
      },
      writeEventSourceId: async (eventId, sourceId) => {
        await client.calendar.event.update({ event: { eventId, sourceId } })
      },
      log,
    }
    // Live sync keeps the default client. Dry-run swaps the fetcher and the two write ports only.
    let api: ServiceTitanClient
    if (config.dryRun) {
      const dry = installDryRun({
        fetcher: fetch,
        ports,
        eventId: event.id,
        accountId: event.account.accountId,
        jobFieldId: config.serviceTitanJobId,
      })
      ports = dry.ports
      api = new ServiceTitanClient(secrets, dry.fetcher, new RunBudget(), { allowSyntheticIds: true })
    } else {
      api = new ServiceTitanClient(secrets)
    }
    outcome = await sync(payload, config, api, ports)
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
  else if (dryRun) console.info(`ServiceTitan dry-run proposed changes: ${JSON.stringify(outcome)}`)
  else console.info(`ServiceTitan sync wrote changes: ${JSON.stringify(outcome)}`)
})
