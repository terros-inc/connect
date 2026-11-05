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
      "Recent production API requests (app, API key, Connect key, CLI), newest first, from the last day by default and at most the last 7 days. Some calls aren't logged, such as sign-in, password, token and history calls. New records appear within about 60 s. Requires internal access. Use `terros apiHistory start` instead to filter by user or see the whole query response.",
    parameters: apiLogParameters,
    async run({ params }: { params: ParsedArgs }): Promise<void> {
      const result = await runApiHistoryQuery(buildTerrosClient(), parseApiLogParams(params))
      if (result.sinceClipped)
        console.error(`Requested --since was clipped to the seven-day limit (${result.effectiveSince ?? 'unknown'})`)
      console.log(JSON.stringify(result.requests ?? [], null, 2))
    },
  },
}
