import type { ParsedArgs } from 'minimist'
import { loadEndpointsAfterRefresh } from '../loadEndpoints'
import { clearOpenApiCache } from '../cache'
import { runApiHistoryQuery } from '../apiHistory'
import { buildTerrosClient } from '../api/query'
import { apiLogParameters, parseApiLogParams } from './apiLogParams'

export const apiCommands = {
  refresh: {
    description:
      'Refresh the cached API schema, so commands for newly added endpoints appear. The CLI also does this when a command is missing.',
    async run(): Promise<void> {
      await clearOpenApiCache()
      const { schemaStatus } = await loadEndpointsAfterRefresh()
      if (schemaStatus === 'available') {
        console.log('API schema refreshed. Retry the endpoint command.')
        return
      }

      console.error(
        'The API schema could not be refreshed. Check your network connection, or update the CLI with `npm install -g @terros-inc/cli`, and retry.'
      )
      process.exitCode = 1
    },
  },
  log: {
    description:
      "Show a company's recent API requests from the last seven days, newest first. Requires internal access.",
    parameters: apiLogParameters,
    async run({ params }: { params: ParsedArgs }): Promise<void> {
      const result = await runApiHistoryQuery(buildTerrosClient(), parseApiLogParams(params))
      if (result.sinceClipped)
        console.error(`Requested --since was clipped to the seven-day limit (${result.effectiveSince ?? 'unknown'})`)
      console.log(JSON.stringify(result.requests ?? [], null, 2))
    },
  },
}
